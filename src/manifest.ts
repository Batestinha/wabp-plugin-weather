import type { PluginManifest } from '@wabs/plugin-sdk/manifest';
import { weatherConfigSchema } from './config';
import { weatherMessages } from './messages';
import {
  WEATHER_QUERY_METHOD,
  WEATHER_SERVICE_ID
} from './serviceApi';

export const WEATHER_PLUGIN_ID = 'official.weather';

export const weatherManifest: PluginManifest = {
  pluginId: WEATHER_PLUGIN_ID,
  kind: 'managed_group',
  version: '0.5.2',
  coreApiRange: '^0.3.0',
  messageNamespace: 'official.weather',
  descriptionKey: 'official.weather.description',
  defaultMessages: weatherMessages,
  commands: ['/weather'],
  help: {
    featureId: 'weather',
    titleKey: 'official.weather.help.feature.title',
    summaryKey: 'official.weather.help.feature.summary',
    order: 30,
    aliases: ['forecast', 'temperature', 'rain', 'marine'],
    topics: [{
      topicId: 'weather-forecast',
      titleKey: 'official.weather.help.forecast.title',
      summaryKey: 'official.weather.help.forecast.summary',
      order: 10,
      commands: ['/weather'],
      instructionKeys: ['official.weather.help.forecast.instruction'],
      exampleKeys: ['official.weather.help.forecast.example.current', 'official.weather.help.forecast.example.range'],
      keywords: ['current', 'forecast', 'location', 'day', 'range', 'marine'],
      availability: { invocation: 'group_only', requiredAccessPlane: 'group_member' }
    }]
  },
  eventSubscriptions: [],
  services: [{
    serviceId: WEATHER_SERVICE_ID,
    methods: [{
      name: WEATHER_QUERY_METHOD,
      access: 'read'
    }]
  }],
  requiredPermissions: [],
  requiredBotCapabilities: [],
  configSchema: weatherConfigSchema,
  dangerousActions: [],
  backgroundJobs: [],
  cancellation: { workflows: [] },
  dependencies: [
    { pluginId: 'official.geocoder', versionRange: '>=0.1.0' }
  ],
  assistant: {
    summary: 'Location-based current weather and forecasts through one command, one unified query service, and one typed assistant tool.',
    useCases: [
      'Show current weather for a named location.',
      'Show one forecast day or an inclusive forecast range up to 15 days ahead.',
      'Expose the same normalized weather query used by /weather to other plugins and the natural-language assistant.'
    ],
    prerequisites: [
      'The plugin must be enabled for the target scope.',
      'official.geocoder must be installed and enabled for named-location lookups.'
    ],
    workflows: [{
      intent: 'weather_query',
      description: 'Show current weather or a selected forecast day range for a named location.',
      commands: ['/weather']
    }]
  }
};
