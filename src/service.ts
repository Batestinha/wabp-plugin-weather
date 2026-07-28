import { createHash } from 'node:crypto';
import type { PluginEphemeralStore } from '../../../platform/pluginRuntime/runtime/pluginEphemeralStore';
import type {
  PluginServiceCallContext,
  PluginServiceRegistration
} from '../../../platform/pluginRuntime/pluginServices';
import type { PluginServiceRegistrationContext } from '../../../platform/pluginRuntime/types';
import {
  GEOCODER_GEOCODE_METHOD,
  GEOCODER_SERVICE_ID,
  type GeocodeOutput
} from '../geocoder/serviceApi';
import { parseWeatherConfig, type WeatherConfig, type WeatherMetricFlags } from './config';
import {
  WEATHER_QUERY_METHOD,
  WEATHER_SERVICE_ID,
  type WeatherCurrentOutput,
  type WeatherDaySelection,
  type WeatherForecastOutput,
  type WeatherMarineMode,
  type WeatherMarineMetricKey,
  type WeatherMetricValue,
  type WeatherQueryInput,
  type WeatherQueryOutput,
  type WeatherServiceLocation,
  type WeatherTideEvent,
  weatherQueryInputSchema,
  weatherQueryOutputSchema
} from './serviceApi';

type JsonRecord = Record<string, unknown>;
type WeatherMetricOverrides = {
  [Key in keyof WeatherMetricFlags]?: WeatherMetricFlags[Key] | undefined;
};

const AUTO_MARINE_MAX_SEA_CELL_DISTANCE_KM = 35;
const EARTH_RADIUS_KM = 6371.0088;

export function registerWeatherServices(context: PluginServiceRegistrationContext): PluginServiceRegistration[] {
  return [{
    serviceId: WEATHER_SERVICE_ID,
    methods: [{
      name: WEATHER_QUERY_METHOD,
      access: 'read',
      inputSchema: weatherQueryInputSchema,
      outputSchema: weatherQueryOutputSchema,
      async handler(rawInput, call) {
        const input = rawInput as WeatherQueryInput;
        const config = parseWeatherConfig(await context.configFor(call.scopeId, call.actorWid));
        assertWeatherEnabled(config);
        const location = await resolveQueryLocation(context, input, call);
        const metrics = queryMetrics(config, input);
        return cached(context.ephemeralStore, config, 'query', {
          input: { ...input, location },
          metrics
        }, async (): Promise<WeatherQueryOutput> => {
          if (!input.selection) {
            return {
              kind: 'current',
              report: await fetchCurrentWeather({
                config,
                location,
                metrics,
                signal: call.signal
              })
            };
          }
          return {
            kind: 'forecast',
            selection: input.selection,
            report: await fetchWeatherForecast({
              config,
              location,
              metrics,
              selection: input.selection,
              marineMode: input.includeMarine,
              signal: call.signal
            })
          };
        });
      }
    }]
  }];
}

function assertWeatherEnabled(config: WeatherConfig): void {
  if (!config.enabled) {
    throw new Error('official.weather is disabled for this scope.');
  }
  if (config.provider !== 'open-meteo') {
    throw new Error(`Unsupported weather provider: ${config.provider}`);
  }
}

async function fetchCurrentWeather(input: {
  config: WeatherConfig;
  location: WeatherServiceLocation;
  metrics: WeatherMetricFlags;
  signal?: AbortSignal | undefined;
}): Promise<WeatherCurrentOutput> {
  const forecastVariables = currentForecastVariables(input.metrics);
  const forecastJson = await fetchJson(forecastUrl({
    config: input.config,
    location: input.location,
    current: fallbackVariables(forecastVariables, ['weather_code']),
    forecastDays: 1
  }), input.signal);
  const current = currentConditions(forecastJson);

  return {
    provider: 'open-meteo',
    fetchedAt: new Date().toISOString(),
    location: input.location,
    units: input.config.units,
    current
  };
}

async function fetchWeatherForecast(input: {
  config: WeatherConfig;
  location: WeatherServiceLocation;
  metrics: WeatherMetricFlags;
  selection: WeatherDaySelection;
  marineMode: WeatherMarineMode;
  signal?: AbortSignal | undefined;
}): Promise<WeatherForecastOutput> {
  const days = input.selection.endDay + 1;
  const forecastJson = await fetchJson(forecastUrl({
    config: input.config,
    location: input.location,
    daily: fallbackVariables(dailyForecastVariables(input.metrics), ['weather_code']),
    forecastDays: days
  }), input.signal);
  const forecast = forecastDays(forecastJson);
  const requestedMarineMetrics = marineMetricKeys(input.metrics);
  let marineByDate = new Map<string, NonNullable<WeatherForecastOutput['days'][number]['marine']>>();
  if (requestedMarineMetrics.length > 0) {
    try {
      const marineJson = await fetchJson(marineForecastUrl({
        config: input.config,
        location: input.location,
        metrics: input.metrics,
        forecastDays: days
      }), input.signal);
      if (input.marineMode === true || marineResponseIsCoastal(marineJson, input.location)) {
        marineByDate = marineForecastDays(marineJson, forecast.map((day) => day.date), input.metrics);
      }
    } catch {
      if (input.marineMode === true) {
        marineByDate = unavailableMarineForecastDays(
          forecast.map((day) => day.date),
          requestedMarineMetrics
        );
      }
    }
  }
  return {
    provider: 'open-meteo',
    fetchedAt: new Date().toISOString(),
    location: input.location,
    units: input.config.units,
    days: forecast.slice(input.selection.startDay, input.selection.endDay + 1).map((day) => ({
      ...day,
      ...(marineByDate.get(day.date) ? { marine: marineByDate.get(day.date)! } : {})
    }))
  };
}

async function cached<T>(
  store: PluginEphemeralStore,
  config: WeatherConfig,
  method: string,
  input: unknown,
  produce: () => Promise<T>
): Promise<T> {
  const ttlSeconds = config.cacheTtlSeconds;
  const key = `weather:${method}:${hash(input)}`;
  if (ttlSeconds > 0) {
    const cachedValue = await store.get<T>(key);
    if (cachedValue) {
      return cachedValue;
    }
  }
  const value = await produce();
  if (ttlSeconds > 0) {
    await store.set(key, value, ttlSeconds);
  }
  return value;
}

function hash(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 24);
}

async function resolveQueryLocation(
  context: PluginServiceRegistrationContext,
  input: WeatherQueryInput,
  call: PluginServiceCallContext
): Promise<WeatherServiceLocation> {
  if (typeof input.location !== 'string') {
    return input.location;
  }
  if (!context.services) {
    throw new Error('Location lookup is unavailable.');
  }
  const geocoded = await context.services.call<GeocodeOutput>({
    serviceId: GEOCODER_SERVICE_ID,
    method: GEOCODER_GEOCODE_METHOD,
    scopeId: call.scopeId,
    ...(call.actorWid ? { actorWid: call.actorWid } : {}),
    ...(call.groupId ? { groupId: call.groupId } : {}),
    ...(call.groupWid ? { groupWid: call.groupWid } : {}),
    input: {
      query: input.location,
      ...(input.language ? { language: input.language } : {}),
      limit: 1
    },
    ...(call.signal ? { signal: call.signal } : {})
  });
  const place = geocoded.results[0];
  if (!place) {
    throw new Error(`No location found for "${input.location}".`);
  }
  return {
    label: place.label,
    latitude: place.point.latitude,
    longitude: place.point.longitude,
    timezone: 'auto'
  };
}

function queryMetrics(config: WeatherConfig, input: WeatherQueryInput): WeatherMetricFlags {
  const metrics = mergeMetrics(config, input.metrics);
  if (input.includeMarine === false) {
    metrics.tide = false;
    metrics.wave = false;
    metrics.oceanCurrent = false;
    metrics.seaSurfaceTemperature = false;
  }
  return metrics;
}

function mergeMetrics(config: WeatherConfig, overrides?: WeatherMetricOverrides | undefined): WeatherMetricFlags {
  const next: WeatherMetricFlags = { ...config.metrics };
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (typeof value === 'boolean') {
      next[key as keyof WeatherMetricFlags] = value;
    }
  }
  return next;
}

function currentForecastVariables(metrics: WeatherMetricFlags): string[] {
  return [
    ...(metrics.temperature ? ['temperature_2m'] : []),
    ...(metrics.apparentTemperature ? ['apparent_temperature'] : []),
    ...(metrics.relativeHumidity ? ['relative_humidity_2m'] : []),
    ...(metrics.precipitation ? ['precipitation'] : []),
    ...(metrics.weatherCode ? ['weather_code'] : []),
    ...(metrics.wind ? ['wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m'] : [])
  ];
}

function dailyForecastVariables(metrics: WeatherMetricFlags): string[] {
  return [
    ...(metrics.weatherCode ? ['weather_code'] : []),
    ...(metrics.temperature ? ['temperature_2m_max', 'temperature_2m_min'] : []),
    ...(metrics.relativeHumidity
      ? ['relative_humidity_2m_max', 'relative_humidity_2m_min', 'relative_humidity_2m_mean']
      : []),
    ...(metrics.precipitation ? ['precipitation_sum', 'precipitation_probability_max'] : []),
    ...(metrics.wind ? ['wind_speed_10m_max', 'wind_gusts_10m_max', 'wind_direction_10m_dominant'] : [])
  ];
}

function marineMetricKeys(metrics: WeatherMetricFlags): WeatherMarineMetricKey[] {
  return [
    ...(metrics.tide ? ['tide' as const] : []),
    ...(metrics.wave ? ['wave' as const] : []),
    ...(metrics.oceanCurrent ? ['oceanCurrent' as const] : []),
    ...(metrics.seaSurfaceTemperature ? ['seaSurfaceTemperature' as const] : [])
  ];
}

function fallbackVariables(values: string[], fallback: string[]): string[] {
  return values.length > 0 ? values : fallback;
}

function forecastUrl(input: {
  config: WeatherConfig;
  location: WeatherServiceLocation;
  current?: string[] | undefined;
  daily?: string[] | undefined;
  forecastDays: number;
}): string {
  const url = new URL(input.config.providerSettings.openMeteo.forecastBaseUrl);
  url.searchParams.set('latitude', String(input.location.latitude));
  url.searchParams.set('longitude', String(input.location.longitude));
  url.searchParams.set('timezone', input.location.timezone);
  url.searchParams.set('forecast_days', String(input.forecastDays));
  if (input.current?.length) {
    url.searchParams.set('current', input.current.join(','));
  }
  if (input.daily?.length) {
    url.searchParams.set('daily', input.daily.join(','));
  }
  if (input.config.units.temperatureUnit !== 'celsius') {
    url.searchParams.set('temperature_unit', input.config.units.temperatureUnit);
  }
  if (input.config.units.windSpeedUnit !== 'kmh') {
    url.searchParams.set('wind_speed_unit', input.config.units.windSpeedUnit);
  }
  if (input.config.units.precipitationUnit !== 'mm') {
    url.searchParams.set('precipitation_unit', input.config.units.precipitationUnit);
  }
  return url.toString();
}

function marineForecastUrl(input: {
  config: WeatherConfig;
  location: WeatherServiceLocation;
  metrics: WeatherMetricFlags;
  forecastDays: number;
}): string {
  const url = new URL(input.config.providerSettings.openMeteo.marineBaseUrl);
  url.searchParams.set('latitude', String(input.location.latitude));
  url.searchParams.set('longitude', String(input.location.longitude));
  url.searchParams.set('timezone', input.location.timezone);
  url.searchParams.set('forecast_days', String(input.forecastDays));
  url.searchParams.set('cell_selection', 'sea');
  if (input.metrics.tide) {
    url.searchParams.set('minutely_15', 'sea_level_height_msl');
  }
  if (input.metrics.wave) {
    url.searchParams.set('daily', [
      'wave_height_max',
      'wave_direction_dominant',
      'wave_period_max'
    ].join(','));
  }
  const hourly = [
    ...(input.metrics.oceanCurrent
      ? ['ocean_current_velocity', 'ocean_current_direction']
      : []),
    ...(input.metrics.seaSurfaceTemperature ? ['sea_surface_temperature'] : [])
  ];
  if (hourly.length > 0) {
    url.searchParams.set('hourly', hourly.join(','));
  }
  if (input.config.units.windSpeedUnit !== 'kmh') {
    url.searchParams.set('wind_speed_unit', input.config.units.windSpeedUnit);
  }
  return url.toString();
}

function marineResponseIsCoastal(response: JsonRecord, location: WeatherServiceLocation): boolean {
  const seaLatitude = numberValue(response.latitude);
  const seaLongitude = numberValue(response.longitude);
  if (seaLatitude === undefined || seaLongitude === undefined) {
    return false;
  }
  return haversineDistanceKm(
    location.latitude,
    location.longitude,
    seaLatitude,
    seaLongitude
  ) <= AUTO_MARINE_MAX_SEA_CELL_DISTANCE_KM;
}

function haversineDistanceKm(
  startLatitude: number,
  startLongitude: number,
  endLatitude: number,
  endLongitude: number
): number {
  const startLatRad = degreesToRadians(startLatitude);
  const endLatRad = degreesToRadians(endLatitude);
  const deltaLatRad = degreesToRadians(endLatitude - startLatitude);
  const deltaLonRad = degreesToRadians(endLongitude - startLongitude);
  const sinDeltaLat = Math.sin(deltaLatRad / 2);
  const sinDeltaLon = Math.sin(deltaLonRad / 2);
  const a = sinDeltaLat ** 2 + Math.cos(startLatRad) * Math.cos(endLatRad) * sinDeltaLon ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function degreesToRadians(value: number): number {
  return value * Math.PI / 180;
}

async function fetchJson(url: string, signal?: AbortSignal | undefined): Promise<JsonRecord> {
  const response = await fetch(url, signal ? { signal } : undefined);
  if (!response.ok) {
    throw new Error(`Weather provider request failed with HTTP ${response.status}.`);
  }
  const body = await response.json();
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Weather provider returned an invalid response.');
  }
  return body as JsonRecord;
}

function currentConditions(response: JsonRecord): WeatherCurrentOutput['current'] {
  const current = record(response.current);
  const units = record(response.current_units);
  return {
    time: stringValue(current.time, 'unknown'),
    ...metric(current, units, 'temperature_2m', 'temperature2m'),
    ...metric(current, units, 'apparent_temperature', 'apparentTemperature'),
    ...metric(current, units, 'relative_humidity_2m', 'relativeHumidity2m'),
    ...metric(current, units, 'precipitation', 'precipitation'),
    ...numberField(current, 'weather_code', 'weatherCode'),
    ...metric(current, units, 'wind_speed_10m', 'windSpeed10m'),
    ...metric(current, units, 'wind_direction_10m', 'windDirection10m'),
    ...metric(current, units, 'wind_gusts_10m', 'windGusts10m')
  };
}

function forecastDays(response: JsonRecord): WeatherForecastOutput['days'] {
  const daily = record(response.daily);
  const units = record(response.daily_units);
  const dates = stringArray(daily.time);
  return dates.map((date, index) => ({
    date,
    ...numberFieldAt(daily, 'weather_code', 'weatherCode', index),
    ...metricAt(daily, units, 'temperature_2m_max', 'temperatureMax', index),
    ...metricAt(daily, units, 'temperature_2m_min', 'temperatureMin', index),
    ...metricAt(daily, units, 'relative_humidity_2m_max', 'relativeHumidityMax', index),
    ...metricAt(daily, units, 'relative_humidity_2m_min', 'relativeHumidityMin', index),
    ...metricAt(daily, units, 'relative_humidity_2m_mean', 'relativeHumidityMean', index),
    ...metricAt(daily, units, 'precipitation_sum', 'precipitationSum', index),
    ...metricAt(daily, units, 'precipitation_probability_max', 'precipitationProbabilityMax', index),
    ...metricAt(daily, units, 'wind_speed_10m_max', 'windSpeedMax', index),
    ...metricAt(daily, units, 'wind_gusts_10m_max', 'windGustsMax', index),
    ...metricAt(daily, units, 'wind_direction_10m_dominant', 'windDirectionDominant', index)
  }));
}

function marineForecastDays(
  response: JsonRecord,
  dates: string[],
  metrics: WeatherMetricFlags
): Map<string, NonNullable<WeatherForecastOutput['days'][number]['marine']>> {
  const requested = marineMetricKeys(metrics);
  const tideEventsByDate = tideEvents(response);
  const daily = record(response.daily);
  const dailyUnits = record(response.daily_units);
  const dailyDates = stringArray(daily.time);
  const hourly = record(response.hourly);
  const hourlyUnits = record(response.hourly_units);
  const hourlyTimes = stringArray(hourly.time);
  const result = new Map<string, NonNullable<WeatherForecastOutput['days'][number]['marine']>>();

  for (const date of dates) {
    const unavailable: WeatherMarineMetricKey[] = [];
    const tideForDate = tideEventsByDate.get(date) ?? [];
    const dailyIndex = dailyDates.indexOf(date);
    const currentSummary = hourlyMarineSummary(hourly, hourlyUnits, hourlyTimes, date);
    const waveHeightMax = dailyIndex >= 0
      ? metricValueAt(daily, dailyUnits, 'wave_height_max', dailyIndex)
      : undefined;
    const waveDirectionDominant = dailyIndex >= 0
      ? metricValueAt(daily, dailyUnits, 'wave_direction_dominant', dailyIndex)
      : undefined;
    const wavePeriodMax = dailyIndex >= 0
      ? metricValueAt(daily, dailyUnits, 'wave_period_max', dailyIndex)
      : undefined;

    if (metrics.tide && tideForDate.length === 0) {
      unavailable.push('tide');
    }
    if (metrics.wave && !waveHeightMax && !waveDirectionDominant && !wavePeriodMax) {
      unavailable.push('wave');
    }
    if (metrics.oceanCurrent && !currentSummary.oceanCurrentVelocityMax) {
      unavailable.push('oceanCurrent');
    }
    if (
      metrics.seaSurfaceTemperature &&
      !currentSummary.seaSurfaceTemperatureMin &&
      !currentSummary.seaSurfaceTemperatureMax
    ) {
      unavailable.push('seaSurfaceTemperature');
    }

    result.set(date, {
      requested,
      unavailable,
      tideEvents: tideForDate,
      ...(waveHeightMax ? { waveHeightMax } : {}),
      ...(waveDirectionDominant ? { waveDirectionDominant } : {}),
      ...(wavePeriodMax ? { wavePeriodMax } : {}),
      ...currentSummary
    });
  }
  return result;
}

function unavailableMarineForecastDays(
  dates: string[],
  requested: WeatherMarineMetricKey[]
): Map<string, NonNullable<WeatherForecastOutput['days'][number]['marine']>> {
  return new Map(dates.map((date) => [
    date,
    {
      requested,
      unavailable: [...requested],
      tideEvents: []
    }
  ]));
}

function tideEvents(response: JsonRecord): Map<string, WeatherTideEvent[]> {
  const values = record(response.minutely_15);
  const units = record(response.minutely_15_units);
  const times = stringArray(values.time);
  const heights = Array.isArray(values.sea_level_height_msl)
    ? values.sea_level_height_msl
    : [];
  const unit = stringValue(units.sea_level_height_msl, '');
  const result = new Map<string, WeatherTideEvent[]>();

  for (let index = 1; index < times.length - 1; index += 1) {
    const previous = numberValue(heights[index - 1]);
    const current = numberValue(heights[index]);
    const next = numberValue(heights[index + 1]);
    if (previous === undefined || current === undefined || next === undefined) {
      continue;
    }
    const type = current > previous && current >= next
      ? 'high'
      : current < previous && current <= next
        ? 'low'
        : undefined;
    if (!type) {
      continue;
    }
    const time = times[index]!;
    const date = time.slice(0, 10);
    const events = result.get(date) ?? [];
    events.push({
      type,
      time,
      height: { value: current, unit }
    });
    result.set(date, events);
  }

  return result;
}

function hourlyMarineSummary(
  hourly: JsonRecord,
  units: JsonRecord,
  times: string[],
  date: string
): Pick<
  NonNullable<WeatherForecastOutput['days'][number]['marine']>,
  | 'oceanCurrentTime'
  | 'oceanCurrentVelocityMax'
  | 'oceanCurrentDirectionAtMax'
  | 'seaSurfaceTemperatureMin'
  | 'seaSurfaceTemperatureMax'
> {
  const indices = times
    .map((time, index) => ({ time, index }))
    .filter((entry) => entry.time.slice(0, 10) === date);
  let currentMax: { time: string; value: number; direction?: number | undefined } | undefined;
  const temperatures: number[] = [];

  for (const entry of indices) {
    const velocity = numberArrayValue(hourly.ocean_current_velocity, entry.index);
    if (velocity !== undefined && (!currentMax || velocity > currentMax.value)) {
      currentMax = {
        time: entry.time,
        value: velocity,
        direction: numberArrayValue(hourly.ocean_current_direction, entry.index)
      };
    }
    const temperature = numberArrayValue(hourly.sea_surface_temperature, entry.index);
    if (temperature !== undefined) {
      temperatures.push(temperature);
    }
  }

  const temperatureUnit = stringValue(units.sea_surface_temperature, '');
  return {
    ...(currentMax ? {
      oceanCurrentTime: currentMax.time,
      oceanCurrentVelocityMax: {
        value: currentMax.value,
        unit: stringValue(units.ocean_current_velocity, '')
      },
      ...(currentMax.direction !== undefined ? {
        oceanCurrentDirectionAtMax: {
          value: currentMax.direction,
          unit: stringValue(units.ocean_current_direction, '')
        }
      } : {})
    } : {}),
    ...(temperatures.length > 0 ? {
      seaSurfaceTemperatureMin: {
        value: Math.min(...temperatures),
        unit: temperatureUnit
      },
      seaSurfaceTemperatureMax: {
        value: Math.max(...temperatures),
        unit: temperatureUnit
      }
    } : {})
  };
}

function metricValueAt(
  values: JsonRecord,
  units: JsonRecord,
  sourceKey: string,
  index: number
): WeatherMetricValue | undefined {
  const value = numberArrayValue(values[sourceKey], index);
  return value === undefined
    ? undefined
    : {
        value,
        unit: stringValue(units[sourceKey], '')
      };
}

function metric(
  values: JsonRecord,
  units: JsonRecord,
  sourceKey: string,
  targetKey: string
): Record<string, WeatherMetricValue> {
  const value = numberValue(values[sourceKey]);
  if (value === undefined) {
    return {};
  }
  return {
    [targetKey]: {
      value,
      unit: stringValue(units[sourceKey], '')
    }
  };
}

function metricAt(
  values: JsonRecord,
  units: JsonRecord,
  sourceKey: string,
  targetKey: string,
  index: number
): Record<string, WeatherMetricValue> {
  const value = numberArrayValue(values[sourceKey], index);
  if (value === undefined) {
    return {};
  }
  return {
    [targetKey]: {
      value,
      unit: stringValue(units[sourceKey], '')
    }
  };
}

function numberField(values: JsonRecord, sourceKey: string, targetKey: string): Record<string, number> {
  const value = numberValue(values[sourceKey]);
  return value === undefined ? {} : { [targetKey]: Math.trunc(value) };
}

function numberFieldAt(values: JsonRecord, sourceKey: string, targetKey: string, index: number): Record<string, number> {
  const value = numberArrayValue(values[sourceKey], index);
  return value === undefined ? {} : { [targetKey]: Math.trunc(value) };
}

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function numberArrayValue(value: unknown, index: number): number | undefined {
  return Array.isArray(value) ? numberValue(value[index]) : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}
