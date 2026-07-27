import type { BotPlugin } from '../../../platform/pluginRuntime/types';
import { weatherManifest } from './manifest';
import { registerWeatherServices } from './service';

export const weatherPlugin: BotPlugin = {
  manifest: weatherManifest,
  registerServices(context) {
    return registerWeatherServices(context);
  }
};

export default weatherPlugin;
