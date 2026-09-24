import type { WeatherConfig } from './config';
import type { WeatherServiceLocation, WeatherTideContext, WeatherTideEvent } from './serviceApi';

type JsonRecord = Record<string, unknown>;
type Profile = {
  name: string; latitude: number; longitude: number; radiusKm: number;
  file: string; correction: number; ids: string[];
};

const PROFILES: Profile[] = [
  { name: 'Viana do Castelo', latitude: 41.6837114, longitude: -8.8386142, radiusKm: 15, file: 'VianaFCUL%d.TXT', correction: -0.28, ids: ['74-267', '894-308'] },
  { name: 'Leixões', latitude: 41.1854734, longitude: -8.7040444, radiusKm: 15, file: 'LeixoesFCUL%d.TXT', correction: -0.28, ids: ['12-184', '159-294'] },
  { name: 'Aveiro', latitude: 40.6441568, longitude: -8.7486849, radiusKm: 15, file: 'AveiroFCUL%d.TXT', correction: -0.26, ids: ['857-177', '160-285'] },
  { name: 'Figueira da Foz', latitude: 40.1470267, longitude: -8.8532498, radiusKm: 15, file: 'FigueiraFCUL%d.TXT', correction: -0.28, ids: ['866-295', '896-296'] },
  { name: 'Peniche', latitude: 39.3535667, longitude: -9.3674056, radiusKm: 15, file: 'PenicheFCUL%d.TXT', correction: -0.26, ids: ['855-305', '162-309'] },
  { name: 'Cascais', latitude: 38.6944444, longitude: -9.4180556, radiusKm: 15, file: 'CascaisFCUL%d.TXT', correction: -0.28, ids: [] },
  { name: 'Lisboa — Alcântara', latitude: 38.7001940, longitude: -9.1632500, radiusKm: 15, file: 'LisboaFCUL%d.TXT', correction: -0.25, ids: ['152-303', '897-298'] },
  { name: 'Setúbal — Tróia', latitude: 38.4944358, longitude: -8.9007503, radiusKm: 15, file: 'SetubalFCUL%d.TXT', correction: -0.26, ids: ['20-311', '898-299'] },
  { name: 'Sines', latitude: 37.9487403, longitude: -8.8884982, radiusKm: 15, file: 'SinesFCUL%d.TXT', correction: -0.26, ids: ['43-269', '900-306'] },
  { name: 'Sagres', latitude: 37.0060, longitude: -8.9430, radiusKm: 15, file: 'SagresFCUL%d.TXT', correction: -0.28, ids: [] },
  { name: 'Lagos', latitude: 37.0986111, longitude: -8.6666667, radiusKm: 15, file: 'LagosFCUL%d.TXT', correction: -0.33, ids: [] },
  { name: 'Albufeira', latitude: 37.0870, longitude: -8.2510, radiusKm: 15, file: 'AlbufeiraFCUL%d.TXT', correction: -0.28, ids: [] },
  { name: 'Faro', latitude: 36.9778027, longitude: -7.8663946, radiusKm: 15, file: 'FaroFCUL%d.TXT', correction: -0.26, ids: ['19-259'] },
  { name: 'Vila Real de Santo António', latitude: 37.1934389, longitude: -7.4133917, radiusKm: 15, file: 'VilaRealFCUL%d.TXT', correction: -0.27, ids: ['21-185', '151-281'] },
  { name: 'Sesimbra', latitude: 38.4397973, longitude: -9.1103589, radiusKm: 15, file: 'Sesimbra%d.TXT', correction: -0.26, ids: ['28-297', '156-279'] },
  { name: 'Funchal', latitude: 32.6447835, longitude: -16.9107824, radiusKm: 20, file: 'Funchal%d.TXT', correction: -0.13, ids: ['121-183', '1001-307'] },
  { name: 'Ponta Delgada', latitude: 37.7355975, longitude: -25.6714190, radiusKm: 15, file: 'PontaDelgada%d.TXT', correction: -0.13, ids: ['212-286'] },
  { name: 'Horta', latitude: 38.5338439, longitude: -28.6214467, radiusKm: 15, file: 'Horta%d.TXT', correction: -0.13, ids: ['231-211'] },
  { name: 'Angra do Heroísmo', latitude: 38.6500172, longitude: -27.2218806, radiusKm: 15, file: 'Angra%d.TXT', correction: -0.13, ids: ['221-213'] },
  { name: 'Santa Cruz das Flores', latitude: 39.4555556, longitude: -31.1208333, radiusKm: 15, file: 'SantaCruz%d.TXT', correction: -0.13, ids: [] }
];

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
  const profile = nearestProfile(input.location.latitude, input.location.longitude);
  const [observation, fcul, openMeteo] = await Promise.all([
    profile?.ids.length ? fetchObservation(input.config, profile, input.signal).catch((error) => {
      if (input.signal?.aborted) throw error;
      return undefined;
    }) : undefined,
    profile ? fetchFcul(input.config, profile, input.signal).catch((error) => {
      if (input.signal?.aborted) throw error;
      return undefined;
    }) : undefined,
    fetchOpenMeteo(input.config, input.location, input.forecastDays, input.signal).catch((error) => {
      if (input.signal?.aborted) throw error;
      return undefined;
    })
  ]);
  const coastal = openMeteo
    ? distanceKm(input.location.latitude, input.location.longitude, openMeteo.latitude, openMeteo.longitude) <= 35
    : profile !== undefined;
  const station = profile ? {
    id: observation?.stationId ?? `fcul:${profile.file.slice(0, profile.file.indexOf('%d')).replace(/FCUL$/, '').toLowerCase()}`,
    name: profile.name,
    distanceKm: distanceKm(input.location.latitude, input.location.longitude, profile.latitude, profile.longitude)
  } : undefined;
  const observationContext = observation ? {
    time: observation.time,
    height: { value: observation.height, unit: 'm' }
  } : undefined;

  if (profile && fcul && fcul.length > 0) {
    const currentHeight = observation?.height ?? interpolateFcul(fcul, Date.now());
    return {
      coastal,
      eventsByDate: groupEvents(fcul, input.location.timezone),
      context: {
        forecastSource: 'fcul', datum: 'zh-portugal', quality: 'calibrated-prediction',
        ...(station ? { station } : {}),
        ...(observationContext ? { observation: observationContext } : {}),
        ...(currentHeight !== undefined ? { current: {
          time: observation?.time ?? new Date().toISOString(),
          height: { value: currentHeight, unit: 'm' }, estimated: observation === undefined
        } } : {}),
        calibration: { method: 'fixed-station-offset', offset: { value: profile.correction, unit: 'm' } }
      }
    };
  }

  if (!openMeteo) throw new Error('No tide forecast available');

  let offset = 0;
  let adjustment: WeatherTideContext['adjustment'];
  if (profile && observation) {
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
    coastal,
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

function interpolateFcul(events: WeatherTideEvent[], timestamp: number): number | undefined {
  const index = events.findIndex((event) => Date.parse(event.time) > timestamp);
  if (index < 1) return undefined;
  const before = events[index - 1]!; const after = events[index]!;
  const first = Date.parse(before.time); const second = Date.parse(after.time);
  if (!Number.isFinite(first) || !Number.isFinite(second) || second <= first || second - first > 8 * 60 * 60_000) return undefined;
  const fraction = (timestamp - first) / (second - first);
  return (before.height.value + after.height.value) / 2 +
    (before.height.value - after.height.value) / 2 * Math.cos(Math.PI * fraction);
}

async function fetchObservation(config: WeatherConfig, profile: Profile, signal?: AbortSignal) {
  const base = ensureSlash(config.providerSettings.tides.institutoHidrograficoBaseUrl);
  const now = Date.now();
  const noCache = { cache: 'no-store' as RequestCache, ...(signal ? { signal } : {}) };
  let features: JsonRecord[] = [];
  try {
    const response = await fetch(`${base}collections/tide_obs_nrt/instances/l1/locations?f=json&limit=100`, noCache);
    if (response.ok) {
      const catalogue = await response.json() as JsonRecord;
      features = (Array.isArray(catalogue.features) ? catalogue.features : []).map(record)
        .filter((feature) => typeof feature.id === 'string' && profile.ids.includes(feature.id));
    }
  } catch (error) {
    if (signal?.aborted) throw error;
  }
  if (features.some((feature) => {
    const properties = record(feature.properties);
    return properties.last_date_time !== undefined && properties.last_sea_surface_height !== undefined;
  })) {
    return features.map((feature) => {
      const properties = record(feature.properties);
      return { observation: validObservation(String(feature.id), properties.last_date_time, properties.last_sea_surface_height, now),
        category: properties.category };
    }).filter((item) => item.observation !== undefined)
      .sort((a, b) => Date.parse(b.observation!.time) - Date.parse(a.observation!.time)
        || (b.category === '1' ? 1 : 0) - (a.category === '1' ? 1 : 0))[0]?.observation;
  }
  const since = new Date(now - 20 * 60_000).toISOString();
  const candidates = await Promise.all(profile.ids.map(async (stationId) => {
    try {
      const url = `${base}collections/tide_obs_nrt/instances/l1/locations/${encodeURIComponent(stationId)}?f=json&parameter-name=sea_surface_height&datetime=${encodeURIComponent(`${since}/..`)}`;
      const response = await fetch(url, noCache);
      if (!response.ok) return undefined;
      const json = await response.json() as JsonRecord;
      const coverage = record((Array.isArray(json.coverages) ? json.coverages : [])[0]);
      const times = record(record(record(coverage.domain).axes).t).values;
      const heights = record(record(coverage.ranges).sea_surface_height).values;
      if (!Array.isArray(times) || !Array.isArray(heights) || times.length !== heights.length) return undefined;
      return times.map((time, index) => validObservation(stationId, time, heights[index], now))
        .filter((item) => item !== undefined).sort((a, b) => Date.parse(b.time) - Date.parse(a.time))[0];
    } catch (error) {
      if (signal?.aborted) throw error;
      return undefined;
    }
  }));
  return candidates.filter((item) => item !== undefined).sort((a, b) => Date.parse(b.time) - Date.parse(a.time))[0];
}

function validObservation(stationId: string, time: unknown, height: unknown, now: number) {
  if (typeof time !== 'string' || typeof height !== 'number' || !Number.isFinite(height) || height < -5 || height > 10) return undefined;
  const timestamp = Date.parse(time);
  if (!Number.isFinite(timestamp) || timestamp > now || now - timestamp > 15 * 60_000) return undefined;
  return { stationId, time: new Date(timestamp).toISOString(), height };
}

async function fetchFcul(config: WeatherConfig, profile: Profile, signal?: AbortSignal): Promise<WeatherTideEvent[]> {
  const base = ensureSlash(config.providerSettings.tides.fculBaseUrl);
  const year = new Date().getUTCFullYear();
  const texts = await Promise.all([year - 1, year, year + 1].map(async (item) => {
    const response = await fetch(base + profile.file.replace('%d', String(item)), signal ? { signal } : undefined);
    return response.ok ? response.text() : '';
  }));
  const events: WeatherTideEvent[] = [];
  const pattern = /^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})\s+(-?\d+(?:\.\d+)?)\s+(Preia-Mar|Baixa-Mar)/gm;
  for (const text of texts) {
    for (const match of text.matchAll(pattern)) {
      events.push({
        type: match[4] === 'Preia-Mar' ? 'high' : 'low',
        time: `${match[1]}T${match[2]!.padStart(5, '0')}:00Z`,
        height: { value: Number(match[3]) + profile.correction, unit: 'm' }
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

function nearestProfile(latitude: number, longitude: number) {
  return PROFILES.map((profile) => ({ profile, distance: distanceKm(latitude, longitude, profile.latitude, profile.longitude) }))
    .filter((item) => item.distance <= item.profile.radiusKm).sort((a, b) => a.distance - b.distance)[0]?.profile;
}
function distanceKm(a: number, b: number, c: number, d: number) { const r = (x: number) => x * Math.PI / 180; const x = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2; return 6371.0088 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)); }
function ensureSlash(value: string) { return value.endsWith('/') ? value : `${value}/`; }
function record(value: unknown): JsonRecord { return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}; }
function stringArray(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []; }
function numberArray(value: unknown) { return Array.isArray(value) ? value.map((item) => typeof item === 'number' && Number.isFinite(item) ? item : undefined) : []; }
function number(value: unknown) { return typeof value === 'number' && Number.isFinite(value) ? value : 0; }
