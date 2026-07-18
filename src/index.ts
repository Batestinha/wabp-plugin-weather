import type { BotPlugin } from '../../../platform/pluginRuntime/types';
import { registerWeatherCommands } from './commands';
import { weatherManifest } from './manifest';
import { registerWeatherServices } from './service';

export const weatherPlugin: BotPlugin = {
  manifest: weatherManifest,
  registerCommands(context) {
    registerWeatherCommands(context);
  },
  registerServices(context) {
    return registerWeatherServices(context);
  }
};

export default weatherPlugin;
