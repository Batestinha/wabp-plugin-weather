import type { WeatherConfig } from './config';
import type { WeatherServiceLocation, WeatherTideContext, WeatherTideEvent } from './serviceApi';
import { PORTUGUESE_TIDE_STATIONS, type TideStation } from './tideStations';

type JsonRecord = Record<string, unknown>;

const MAX_STATION_DISTANCE_KM = 120;
const DIRECT_COASTAL_STATION_DISTANCE_KM = 15;
const MAX_SEA_CELL_DISTANCE_KM = 35;

export type TideResult = {
  eventsByDate: Map<string, WeatherTideEvent[]>;
  context: WeatherTideContext;
  coastal: boolean;
};

export async function portugalTides(input: {
  config: WeatherConfig;
  location: WeatherServiceLocation;
  forecastDays: number;
  signal?: AbortSignal | undefined;
}): Promise<TideResult> {
  const stations = nearestStations(input.location.latitude, input.location.longitude);
  let openMeteo: Awaited<ReturnType<typeof fetchOpenMeteo>> | undefined;
  const nearestDistance = stations[0]?.distance ?? Number.POSITIVE_INFINITY;
  if (nearestDistance > DIRECT_COASTAL_STATION_DISTANCE_KM) {
    openMeteo = await fetchOpenMeteo(input.config, input.location, input.forecastDays, input.signal)
      .catch(() => undefined);
  }
  const coastal = nearestDistance <= DIRECT_COASTAL_STATION_DISTANCE_KM ||
    (openMeteo !== undefined &&
      distanceKm(input.location.latitude, input.location.longitude, openMeteo.latitude, openMeteo.longitude) <= MAX_SEA_CELL_DISTANCE_KM);
  if (coastal) {
    for (const { station, distance } of stations.slice(0, 3)) {
      const events = await fetchFcul(input.config, station, input.signal).catch(() => undefined);
      if (events && events.length > 0) {
        return {
          coastal: true,
          eventsByDate: groupEvents(events, input.location.timezone),
          context: {
            forecastSource: 'fcul', datum: 'zh-portugal', quality: 'calibrated-prediction',
            station: { id: `fcul:${station.name}`, name: station.name, distanceKm: distance }
          }
        };
      }
    }
  }

  const observation = await fetchObservation(input.config, input.location, input.signal).catch(() => undefined);
  const station = observation ? {
    id: observation.stationId, name: observation.stationName, distanceKm: observation.distanceKm
  } : undefined;
  const observationContext = observation ? {
    time: observation.time,
    height: { value: observation.height, unit: 'm' }
  } : undefined;
  // Compare IH and Open-Meteo at the same station and instant before carrying the
  // approximate datum offset through that station's forecast.
  const marineLocation = observation ? {
    ...input.location, latitude: observation.latitude, longitude: observation.longitude
  } : input.location;
  openMeteo = observation || !openMeteo
    ? await fetchOpenMeteo(input.config, marineLocation, input.forecastDays, input.signal)
    : openMeteo;
  const fallbackCoastal = distanceKm(input.location.latitude, input.location.longitude, openMeteo.latitude, openMeteo.longitude) <= MAX_SEA_CELL_DISTANCE_KM;
  let offset = 0;
  let adjustment: WeatherTideContext['adjustment'];
  if (observation) {
    const raw = interpolate(openMeteo.samples, Date.parse(observation.time));
    if (raw !== undefined && Math.abs(observation.height - raw) <= 5) {
      offset = observation.height - raw;
      adjustment = {
        at: observation.time,
        ihHeight: { value: observation.height, unit: 'm' },
        openMeteoHeight: { value: raw, unit: 'm' },
        offset: { value: offset, unit: 'm' }
      };
    }
  }
  const samples = openMeteo.samples.map((sample) => ({ ...sample, height: sample.height + offset }));
  return {
    coastal: fallbackCoastal,
    eventsByDate: extrema(samples, input.location.timezone),
    context: {
      forecastSource: 'open-meteo',
      datum: adjustment ? 'ih-anchored-approximate-zh' : 'mean-sea-level',
      quality: adjustment ? 'crude-current-anchor' : 'modelled',
      ...(station ? { station } : {}),
      ...(observationContext ? { observation: observationContext } : {}),
      ...(adjustment ? { adjustment } : {})
    }
  };
}

async function fetchObservation(
  config: WeatherConfig, location: WeatherServiceLocation, signal?: AbortSignal
) {
  const base = ensureSlash(config.providerSettings.tides.institutoHidrograficoBaseUrl);
  const response = await fetch(`${base}collections/tide_obs_nrt/instances/l1/locations?f=json&limit=100`, signal ? { signal } : undefined);
  if (!response.ok) throw new Error(`IH HTTP ${response.status}`);
  const stations = await response.json() as JsonRecord;
  const now = Date.now();
  const candidates = (Array.isArray(stations.features) ? stations.features : [])
    .map((value) => {
      const feature = record(value);
      const properties = record(feature.properties);
      const coordinates = record(feature.geometry).coordinates;
      const longitude = Array.isArray(coordinates) ? coordinates[0] : properties.lon;
      const latitude = Array.isArray(coordinates) ? coordinates[1] : properties.lat;
      const height = properties.last_sea_surface_height;
      const timestamp = Date.parse(String(properties.last_date_time ?? ''));
      const stationId = feature.id;
      if (typeof latitude !== 'number' || typeof longitude !== 'number' ||
        typeof height !== 'number' || !Number.isFinite(height) || height < -5 || height > 10 ||
        typeof stationId !== 'string' || !Number.isFinite(timestamp) ||
        timestamp > now || now - timestamp > 15 * 60_000) return undefined;
      const distanceKmFromLocation = distanceKm(location.latitude, location.longitude, latitude, longitude);
      if (distanceKmFromLocation > 35) return undefined;
      return {
        stationId, stationName: String(properties.title ?? stationId), latitude, longitude,
        distanceKm: distanceKmFromLocation, time: new Date(timestamp).toISOString(), height,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== undefined)
    .sort((a, b) => a.distanceKm - b.distanceKm);
  if (candidates[0]) return candidates[0];
  throw new Error('No fresh IH observation');
}

async function fetchFcul(config: WeatherConfig, station: TideStation, signal?: AbortSignal): Promise<WeatherTideEvent[]> {
  const base = ensureSlash(config.providerSettings.tides.fculBaseUrl);
  const year = new Date().getUTCFullYear();
  const texts = await Promise.all([year - 1, year, year + 1].map(async (item) => {
    const response = await fetch(base + station.file.replace('%d', String(item)), signal ? { signal } : undefined);
    return response.ok ? response.text() : '';
  }));
  const events: WeatherTideEvent[] = [];
  const pattern = /^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})\s+(-?\d+(?:\.\d+)?)\s+(Preia-Mar|Baixa-Mar)/gm;
  for (const text of texts) {
    for (const match of text.matchAll(pattern)) {
      events.push({
        type: match[4] === 'Preia-Mar' ? 'high' : 'low',
        time: `${match[1]}T${match[2]!.padStart(5, '0')}:00Z`,
        height: { value: Number(match[3]), unit: 'm' }
      });
    }
  }
  if (events.length === 0) throw new Error('No FCUL events');
  return events;
}

async function fetchOpenMeteo(config: WeatherConfig, location: WeatherServiceLocation, days: number, signal?: AbortSignal) {
  const url = new URL(config.providerSettings.openMeteo.marineBaseUrl);
  url.searchParams.set('latitude', String(location.latitude));
  url.searchParams.set('longitude', String(location.longitude));
  url.searchParams.set('timezone', 'GMT');
  url.searchParams.set('forecast_days', String(days));
  url.searchParams.set('past_days', '1');
  url.searchParams.set('cell_selection', 'sea');
  url.searchParams.set('minutely_15', 'sea_level_height_msl');
  const response = await fetch(url, signal ? { signal } : undefined);
  if (!response.ok) throw new Error(`Open-Meteo marine HTTP ${response.status}`);
  const json = await response.json() as JsonRecord;
  const values = record(json.minutely_15);
  const times = stringArray(values.time);
  const heights = numberArray(values.sea_level_height_msl);
  const samples = times.map((time, index) => ({ time: Date.parse(`${time}Z`), height: heights[index] }))
    .filter((sample): sample is { time: number; height: number } => Number.isFinite(sample.time) && sample.height !== undefined);
  if (samples.length < 3) throw new Error('No Open-Meteo tide samples');
  return { latitude: number(json.latitude), longitude: number(json.longitude), samples };
}

function extrema(samples: { time: number; height: number }[], timezone: string) {
  const events: WeatherTideEvent[] = [];
  for (let index = 1; index < samples.length - 1; index += 1) {
    const [a, b, c] = [samples[index - 1]!, samples[index]!, samples[index + 1]!];
    const type = b.height > a.height && b.height >= c.height ? 'high' : b.height < a.height && b.height <= c.height ? 'low' : undefined;
    if (type) events.push({ type, time: new Date(b.time).toISOString(), height: { value: b.height, unit: 'm' } });
  }
  return groupEvents(events, timezone);
}

function groupEvents(events: WeatherTideEvent[], timezone: string) {
  const result = new Map<string, WeatherTideEvent[]>();
  for (const event of events) {
    const date = localDate(Date.parse(event.time), timezone);
    result.set(date, [...(result.get(date) ?? []), event]);
  }
  return result;
}

function localDate(timestamp: number, timezone: string) {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' });
  }
  const parts = formatter.formatToParts(timestamp);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function interpolate(samples: { time: number; height: number }[], timestamp: number) {
  for (let index = 0; index < samples.length - 1; index += 1) {
    const a = samples[index]!; const b = samples[index + 1]!;
    if (a.time <= timestamp && timestamp <= b.time && b.time - a.time <= 60 * 60_000) {
      return a.height + (b.height - a.height) * (timestamp - a.time) / (b.time - a.time);
    }
  }
  return undefined;
}

function nearestStations(latitude: number, longitude: number) {
  return PORTUGUESE_TIDE_STATIONS
    .map((station) => ({ station, distance: distanceKm(latitude, longitude, station.latitude, station.longitude) }))
    .filter(({ distance }) => distance <= MAX_STATION_DISTANCE_KM)
    .sort((a, b) => a.distance - b.distance);
}
function distanceKm(a: number, b: number, c: number, d: number) { const r = (x: number) => x * Math.PI / 180; const x = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2; return 6371.0088 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)); }
function ensureSlash(value: string) { return value.endsWith('/') ? value : `${value}/`; }
function record(value: unknown): JsonRecord { return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}; }
function stringArray(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []; }
function numberArray(value: unknown) { return Array.isArray(value) ? value.map((item) => typeof item === 'number' && Number.isFinite(item) ? item : undefined) : []; }
function number(value: unknown) { return typeof value === 'number' && Number.isFinite(value) ? value : 0; }
