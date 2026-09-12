import { defineControl } from '@wabs/plugin-sdk/controls';
import type { ControlDescriptor, ControlSchemaMetadata, ControlUiHint } from '@wabs/plugin-sdk/controls-types';
import { WEATHER_PLUGIN_ID } from './manifest';

function optionValues(values: readonly string[]) {
  return values.map((value) => ({ value, label: value.replace(/-/g, ' ') }));
}

function control(
  path: string,
  label: string,
  description: string,
  order: number,
  schema: ControlSchemaMetadata,
  ui: ControlUiHint,
  section = 'Weather'
): ControlDescriptor {
  return defineControl({
    id: `plugin.official.weather.${path}`,
    label,
    description,
    plane: 'plugin-scope-config',
    domain: 'official-plugin-settings',
    section,
    order,
    visibility: 'bot_admin',
    configurable: true,
    storage: { kind: 'plugin-scope-config', pluginId: WEATHER_PLUGIN_ID, path },
    schema,
    ui: { helpText: description, ...ui },
    restartRequirement: 'NO_RESTART',
    dangerous: false,
    sensitivity: { sensitive: false, redact: 'none' },
    auditAction: 'operator_console.plugin_config.update',
    relatedCommandIds: ['/weather'],
    relatedActionIds: []
  });
}

const PROVIDER_OPTIONS = [{ value: 'open-meteo', label: 'Open-Meteo' }];
const TEMPERATURE_UNIT_OPTIONS = optionValues(['celsius', 'fahrenheit']);
const WIND_UNIT_OPTIONS = [
  { value: 'kmh', label: 'km/h' },
  { value: 'mph', label: 'mph' },
  { value: 'ms', label: 'm/s' },
  { value: 'kn', label: 'knots' }
];
const PRECIPITATION_UNIT_OPTIONS = [
  { value: 'mm', label: 'mm' },
  { value: 'inch', label: 'inch' }
];

export const weatherControls: ControlDescriptor[] = [
  control('enabled', 'Enabled', 'Enable /weather and the unified weather query service for this scope.', 10, { type: 'boolean' }, { widget: 'toggle' }),
  control('provider', 'Provider', 'Weather data provider used by /weather and query service calls.', 20, {
    type: 'enum',
    enum: PROVIDER_OPTIONS
  }, { widget: 'segmented', options: PROVIDER_OPTIONS }),
  control('cacheTtlSeconds', 'Cache TTL', 'Seconds to cache provider responses in the plugin ephemeral store. Use 0 to disable caching.', 30, {
    type: 'number',
    unit: 'seconds',
    min: 0,
    max: 3600
  }, { widget: 'number' }),
  control('units.temperatureUnit', 'Temperature unit', 'Temperature unit for current and forecast weather.', 200, {
    type: 'enum',
    enum: TEMPERATURE_UNIT_OPTIONS
  }, { widget: 'segmented', options: TEMPERATURE_UNIT_OPTIONS }, 'Weather units'),
  control('units.windSpeedUnit', 'Wind speed unit', 'Wind and ocean-current speed unit for weather reports.', 210, {
    type: 'enum',
    enum: WIND_UNIT_OPTIONS
  }, { widget: 'segmented', options: WIND_UNIT_OPTIONS }, 'Weather units'),
  control('units.precipitationUnit', 'Precipitation unit', 'Precipitation unit for current and forecast weather.', 220, {
    type: 'enum',
    enum: PRECIPITATION_UNIT_OPTIONS
  }, { widget: 'segmented', options: PRECIPITATION_UNIT_OPTIONS }, 'Weather units'),

  control('metrics.temperature', 'Temperature', 'Include air temperature in current weather and daily forecasts.', 300, { type: 'boolean' }, { widget: 'toggle' }, 'Weather metrics'),
  control('metrics.apparentTemperature', 'Feels like', 'Include apparent temperature in current weather.', 310, { type: 'boolean' }, { widget: 'toggle' }, 'Weather metrics'),
  control('metrics.relativeHumidity', 'Relative humidity', 'Include relative humidity in current weather.', 320, { type: 'boolean' }, { widget: 'toggle' }, 'Weather metrics'),
  control('metrics.wind', 'Wind', 'Include wind speed, direction, and gust metrics.', 330, { type: 'boolean' }, { widget: 'toggle' }, 'Weather metrics'),
  control('metrics.precipitation', 'Precipitation', 'Include current precipitation and daily precipitation forecast metrics.', 340, { type: 'boolean' }, { widget: 'toggle' }, 'Weather metrics'),
  control('metrics.weatherCode', 'Weather code', 'Include provider weather condition codes.', 350, { type: 'boolean' }, { widget: 'toggle' }, 'Weather metrics'),
  control('metrics.tide', 'Tide / sea level', 'Include forecast high/low tide times for query service consumers that request marine data.', 360, { type: 'boolean' }, { widget: 'toggle' }, 'Marine metrics'),
  control('metrics.wave', 'Wave', 'Include wave height, direction, and period from the marine provider.', 370, { type: 'boolean' }, { widget: 'toggle' }, 'Marine metrics'),
  control('metrics.oceanCurrent', 'Ocean current', 'Include ocean current speed and direction from the marine provider.', 380, { type: 'boolean' }, { widget: 'toggle' }, 'Marine metrics'),
  control('metrics.seaSurfaceTemperature', 'Sea temperature', 'Include sea surface temperature from the marine provider.', 390, { type: 'boolean' }, { widget: 'toggle' }, 'Marine metrics'),

  control('providerSettings.openMeteo.forecastBaseUrl', 'Forecast endpoint', 'Open-Meteo forecast API base URL.', 500, {
    type: 'string',
    format: 'url',
    required: true
  }, { widget: 'url' }, 'Weather provider'),
  control('providerSettings.openMeteo.marineBaseUrl', 'Marine endpoint', 'Open-Meteo marine API base URL.', 510, {
    type: 'string',
    format: 'url',
    required: true
  }, { widget: 'url' }, 'Weather provider')
];
