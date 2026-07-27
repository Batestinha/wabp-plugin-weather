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
  version: '0.3.0',
  coreApiRange: '>=0.2.0',
  messageNamespace: 'official.weather',
  descriptionKey: 'official.weather.description',
  defaultMessages: weatherMessages,
  commands: [],
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
    summary: 'Normalized weather, forecast, tide, wind, humidity, and marine-condition data for other plugins.',
    useCases: [
      'Expose normalized weather and marine data for other plugins through a versioned service API.'
    ],
    prerequisites: [
      'The plugin must be enabled for the target scope.',
      'The operator must configure the location and the metrics that should be reported.'
    ]
  }
};
