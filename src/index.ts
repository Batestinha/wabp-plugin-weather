import type { CommandPlugin } from '../../../../packages/plugin-sdk/src/command-plugin';
import { registerWeatherAssistantTools } from './assistantTools';
import { registerWeatherCommands } from './commands';
import { weatherManifest } from './manifest';
import { registerWeatherServices } from './service';

export const weatherPlugin: CommandPlugin = {
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
