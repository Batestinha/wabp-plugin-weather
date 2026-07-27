import { defineControl } from '../../../platform/operatorConsole/controlCatalog/define';
import type { ControlDescriptor, ControlSchemaMetadata, ControlUiHint } from '../../../platform/operatorConsole/controlCatalog/types';
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
    relatedCommandIds: ['/weather', '/weather current', '/weather forecast', '/weather marine'],
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
  control('enabled', 'Enabled', 'Enable weather commands and the plugin weather service for this scope.', 10, { type: 'boolean' }, { widget: 'toggle' }),
  control('provider', 'Provider', 'Weather data provider used by commands and service calls.', 20, {
    type: 'enum',
    enum: PROVIDER_OPTIONS
  }, { widget: 'segmented', options: PROVIDER_OPTIONS }),
  control('cacheTtlSeconds', 'Cache TTL', 'Seconds to cache provider responses in the plugin ephemeral store. Use 0 to disable caching.', 30, {
    type: 'number',
    unit: 'seconds',
    min: 0,
    max: 3600
  }, { widget: 'number' }),
  control('forecastDays', 'Forecast days', 'Default number of days returned by /weather forecast and service forecast calls.', 40, {
    type: 'number',
    unit: 'days',
    min: 1,
    max: 16
  }, { widget: 'number' }),

  control('location.label', 'Location label', 'Human-readable name shown in weather reports.', 100, { type: 'string', required: true }, {
    widget: 'text',
    placeholder: 'Lisbon'
  }, 'Weather location'),
  control('location.latitude', 'Latitude', 'Configured weather latitude in decimal degrees.', 110, {
    type: 'number',
    min: -90,
    max: 90
  }, { widget: 'number' }, 'Weather location'),
  control('location.longitude', 'Longitude', 'Configured weather longitude in decimal degrees.', 120, {
    type: 'number',
    min: -180,
    max: 180
  }, { widget: 'number' }, 'Weather location'),
  control('location.timezone', 'Timezone', 'IANA timezone used for provider requests and daily forecast boundaries.', 130, {
    type: 'string',
    format: 'timezone',
    required: true
  }, { widget: 'text', placeholder: 'Europe/Lisbon' }, 'Weather location'),

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
  control('metrics.tide', 'Tide / sea level', 'Include current sea-level height and forecast high/low tide times from the marine provider.', 360, { type: 'boolean' }, { widget: 'toggle' }, 'Marine metrics'),
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
