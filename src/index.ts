import type { BotPlugin } from '../../../platform/pluginRuntime/types';
import { registerWeatherAssistantTools } from './assistantTools';
import { registerWeatherCommands } from './commands';
import { weatherManifest } from './manifest';
import { registerWeatherServices } from './service';

export const weatherPlugin: BotPlugin = {
  manifest: weatherManifest,
  registerCommands(context) {
    registerWeatherCommands(context);
  },
  registerAssistantTools(context) {
    return registerWeatherAssistantTools(context);
  },
  registerServices(context) {
    return registerWeatherServices(context);
  }
};

export default weatherPlugin;
