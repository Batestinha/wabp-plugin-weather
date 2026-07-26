import { createHash } from 'node:crypto';
import type { PluginEphemeralStore } from '../../../platform/pluginRuntime/runtime/pluginEphemeralStore';
import type { PluginServiceRegistration } from '../../../platform/pluginRuntime/pluginServices';
import type { PluginServiceRegistrationContext } from '../../../platform/pluginRuntime/types';
import { parseWeatherConfig, type WeatherConfig, type WeatherLocation, type WeatherMetricFlags } from './config';
import {
  WEATHER_CURRENT_METHOD,
  WEATHER_FORECAST_METHOD,
  WEATHER_MARINE_METHOD,
  WEATHER_SERVICE_ID,
  type WeatherCurrentInput,
  type WeatherCurrentOutput,
  type WeatherForecastInput,
  type WeatherForecastOutput,
  type WeatherMarineInput,
  type WeatherMarineOutput,
  type WeatherMetricValue,
  weatherCurrentInputSchema,
  weatherCurrentOutputSchema,
  weatherForecastInputSchema,
  weatherForecastOutputSchema,
  weatherMarineInputSchema,
  weatherMarineOutputSchema
} from './serviceApi';

type JsonRecord = Record<string, unknown>;
type WeatherMetricOverrides = {
  [Key in keyof WeatherMetricFlags]?: WeatherMetricFlags[Key] | undefined;
};

export function registerWeatherServices(context: PluginServiceRegistrationContext): PluginServiceRegistration[] {
  return [{
    serviceId: WEATHER_SERVICE_ID,
    methods: [
      {
        name: WEATHER_CURRENT_METHOD,
        access: 'read',
        inputSchema: weatherCurrentInputSchema,
        outputSchema: weatherCurrentOutputSchema,
        async handler(rawInput, call) {
          const input = rawInput as WeatherCurrentInput;
          const config = parseWeatherConfig(await context.configFor(call.scopeId, call.actorWid));
          assertWeatherEnabled(config);
          const metrics = mergeMetrics(config, input.metrics);
          const includeMarine = input.includeMarine ?? hasMarineMetrics(metrics);
          return cached(context.ephemeralStore, config, 'current', { input, metrics, includeMarine }, () =>
            fetchCurrentWeather({ config, input, metrics, includeMarine, signal: call.signal })
          );
        }
      },
      {
        name: WEATHER_FORECAST_METHOD,
        access: 'read',
        inputSchema: weatherForecastInputSchema,
        outputSchema: weatherForecastOutputSchema,
        async handler(rawInput, call) {
          const input = rawInput as WeatherForecastInput;
          const config = parseWeatherConfig(await context.configFor(call.scopeId, call.actorWid));
          assertWeatherEnabled(config);
          const metrics = mergeMetrics(config, input.metrics);
          return cached(context.ephemeralStore, config, 'forecast', { input, metrics }, () =>
            fetchWeatherForecast({ config, input, metrics, signal: call.signal })
          );
        }
      },
      {
        name: WEATHER_MARINE_METHOD,
        access: 'read',
        inputSchema: weatherMarineInputSchema,
        outputSchema: weatherMarineOutputSchema,
        async handler(rawInput, call) {
          const input = rawInput as WeatherMarineInput;
          const config = parseWeatherConfig(await context.configFor(call.scopeId, call.actorWid));
          assertWeatherEnabled(config);
          const metrics = mergeMetrics(config, marineMetricOverrides(input.metrics));
          return cached(context.ephemeralStore, config, 'marine', { input, metrics }, () =>
            fetchMarineWeather({ config, input, metrics, signal: call.signal })
          );
        }
      }
    ]
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
  input: WeatherCurrentInput;
  metrics: WeatherMetricFlags;
  includeMarine: boolean;
  signal?: AbortSignal | undefined;
}): Promise<WeatherCurrentOutput> {
  const location = resolveLocation(input.config, input.input.location);
  const forecastVariables = currentForecastVariables(input.metrics);
  const forecastJson = await fetchJson(forecastUrl({
    config: input.config,
    location,
    current: fallbackVariables(forecastVariables, ['weather_code']),
    forecastDays: 1
  }), input.signal);
  const current = currentConditions(forecastJson);
  const marine = input.includeMarine
    ? (await fetchMarineWeather({
        config: input.config,
        input: { location: input.input.location },
        metrics: input.metrics,
        signal: input.signal
      })).marine
    : undefined;

  return {
    provider: 'open-meteo',
    fetchedAt: new Date().toISOString(),
    location,
    units: input.config.units,
    current,
    ...(marine ? { marine } : {})
  };
}

async function fetchWeatherForecast(input: {
  config: WeatherConfig;
  input: WeatherForecastInput;
  metrics: WeatherMetricFlags;
  signal?: AbortSignal | undefined;
}): Promise<WeatherForecastOutput> {
  const location = resolveLocation(input.config, input.input.location);
  const days = input.input.days ?? input.config.forecastDays;
  const forecastJson = await fetchJson(forecastUrl({
    config: input.config,
    location,
    daily: fallbackVariables(dailyForecastVariables(input.metrics), ['weather_code']),
    forecastDays: days
  }), input.signal);
  return {
    provider: 'open-meteo',
    fetchedAt: new Date().toISOString(),
    location,
    units: input.config.units,
    days: forecastDays(forecastJson)
  };
}

async function fetchMarineWeather(input: {
  config: WeatherConfig;
  input: WeatherMarineInput | Pick<WeatherCurrentInput, 'location'>;
  metrics: WeatherMetricFlags;
  signal?: AbortSignal | undefined;
}): Promise<WeatherMarineOutput> {
  const location = resolveLocation(input.config, input.input.location);
  const marineJson = await fetchJson(marineUrl({
    config: input.config,
    location,
    current: fallbackVariables(marineVariables(input.metrics), ['sea_level_height_msl'])
  }), input.signal);
  return {
    provider: 'open-meteo',
    fetchedAt: new Date().toISOString(),
    location,
    units: input.config.units,
    marine: marineConditions(marineJson)
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

function resolveLocation(
  config: WeatherConfig,
  override: WeatherCurrentInput['location']
): WeatherLocation {
  return {
    ...config.location,
    ...(override?.label ? { label: override.label } : {}),
    ...(override?.latitude !== undefined ? { latitude: override.latitude } : {}),
    ...(override?.longitude !== undefined ? { longitude: override.longitude } : {}),
    ...(override?.timezone ? { timezone: override.timezone } : {})
  };
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

function marineMetricOverrides(overrides?: WeatherMetricOverrides | undefined): WeatherMetricOverrides {
  return {
    tide: true,
    wave: true,
    oceanCurrent: true,
    seaSurfaceTemperature: true,
    ...definedMetricOverrides(overrides)
  };
}

function definedMetricOverrides(overrides?: WeatherMetricOverrides | undefined): WeatherMetricOverrides {
  const next: WeatherMetricOverrides = {};
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (typeof value === 'boolean') {
      next[key as keyof WeatherMetricFlags] = value;
    }
  }
  return next;
}

function hasMarineMetrics(metrics: WeatherMetricFlags): boolean {
  return metrics.tide || metrics.wave || metrics.oceanCurrent || metrics.seaSurfaceTemperature;
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

function marineVariables(metrics: WeatherMetricFlags): string[] {
  return [
    ...(metrics.tide ? ['sea_level_height_msl'] : []),
    ...(metrics.wave ? ['wave_height', 'wave_direction', 'wave_period'] : []),
    ...(metrics.oceanCurrent ? ['ocean_current_velocity', 'ocean_current_direction'] : []),
    ...(metrics.seaSurfaceTemperature ? ['sea_surface_temperature'] : [])
  ];
}

function fallbackVariables(values: string[], fallback: string[]): string[] {
  return values.length > 0 ? values : fallback;
}

function forecastUrl(input: {
  config: WeatherConfig;
  location: WeatherLocation;
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

function marineUrl(input: {
  config: WeatherConfig;
  location: WeatherLocation;
  current: string[];
}): string {
  const url = new URL(input.config.providerSettings.openMeteo.marineBaseUrl);
  url.searchParams.set('latitude', String(input.location.latitude));
  url.searchParams.set('longitude', String(input.location.longitude));
  url.searchParams.set('timezone', input.location.timezone);
  url.searchParams.set('current', input.current.join(','));
  if (input.config.units.windSpeedUnit !== 'kmh') {
    url.searchParams.set('wind_speed_unit', input.config.units.windSpeedUnit);
  }
  return url.toString();
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

function marineConditions(response: JsonRecord): WeatherMarineOutput['marine'] {
  const current = record(response.current);
  const units = record(response.current_units);
  return {
    time: stringValue(current.time, 'unknown'),
    ...metric(current, units, 'sea_level_height_msl', 'seaLevelHeightMsl'),
    ...metric(current, units, 'wave_height', 'waveHeight'),
    ...metric(current, units, 'wave_direction', 'waveDirection'),
    ...metric(current, units, 'wave_period', 'wavePeriod'),
    ...metric(current, units, 'ocean_current_velocity', 'oceanCurrentVelocity'),
    ...metric(current, units, 'ocean_current_direction', 'oceanCurrentDirection'),
    ...metric(current, units, 'sea_surface_temperature', 'seaSurfaceTemperature')
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
