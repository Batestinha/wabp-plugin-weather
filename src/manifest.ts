import type { PluginManifest } from '../../../platform/pluginRuntime/manifest';
import { weatherConfigSchema } from './config';
import { weatherMessages } from './messages';
import {
  WEATHER_CURRENT_METHOD,
  WEATHER_FORECAST_METHOD,
  WEATHER_MARINE_METHOD,
  WEATHER_SERVICE_ID
} from './serviceApi';

export const WEATHER_PLUGIN_ID = 'official.weather';

export const weatherManifest: PluginManifest = {
  pluginId: WEATHER_PLUGIN_ID,
  kind: 'managed_group',
  version: '0.1.0',
  coreApiRange: '>=0.2.0',
  messageNamespace: 'official.weather',
  descriptionKey: 'official.weather.description',
  defaultMessages: weatherMessages,
  commands: [
    '/weather',
    '/weather current',
    '/weather forecast',
    '/weather marine'
  ],
  eventSubscriptions: [],
  services: [{
    serviceId: WEATHER_SERVICE_ID,
    methods: [
      {
        name: WEATHER_CURRENT_METHOD,
        access: 'read'
      },
      {
        name: WEATHER_FORECAST_METHOD,
        access: 'read'
      },
      {
        name: WEATHER_MARINE_METHOD,
        access: 'read'
      }
    ]
  }],
  requiredPermissions: [],
  requiredBotCapabilities: [],
  configSchema: weatherConfigSchema,
  dangerousActions: [],
  backgroundJobs: [],
  cancellation: { workflows: [] },
  assistant: {
    summary: 'Weather, forecast, tide, wind, humidity, and marine-condition reports for the configured scope location.',
    useCases: [
      'Show current weather for the configured group location.',
      'Show a short multi-day forecast for the configured location.',
      'Expose normalized weather and marine data for other plugins through a versioned service API.'
    ],
    prerequisites: [
      'The plugin must be enabled for the target scope.',
      'The operator must configure the location and the metrics that should be reported.'
    ],
    workflows: [
      {
        intent: 'weather_current',
        description: 'Read current weather for the configured scope location.',
        commands: ['/weather', '/weather current']
      },
      {
        intent: 'weather_forecast',
        description: 'Read the configured forecast for the scope location.',
        commands: ['/weather forecast']
      },
      {
        intent: 'weather_marine',
        description: 'Read marine, tide, wave, and ocean-current conditions for the scope location.',
        commands: ['/weather marine']
      }
    ]
  }
};
