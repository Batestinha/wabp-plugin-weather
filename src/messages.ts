import type { MessageCatalog } from '../../../platform/i18n';

export const weatherMessages: MessageCatalog = {
  'official.weather.description': 'Scoped plugin-to-plugin weather API.',
  'official.weather.marine.forecastTitle': 'Marine forecast for {location}, {date}:',
  'official.weather.tideTimes.title': 'Tide times for {place}, {startDate}:',
  'official.weather.tideTimes.high': 'High Tide {time} ({height})',
  'official.weather.tideTimes.low': 'Low Tide {time} ({height})',
  'official.weather.metric.tide': 'Sea level / tide',
  'official.weather.metric.wave': 'Wave forecast',
  'official.weather.metric.waveHeightMax': 'Maximum wave height',
  'official.weather.metric.waveDirection': 'Wave direction',
  'official.weather.metric.wavePeriod': 'Wave period',
  'official.weather.metric.wavePeriodMax': 'Maximum wave period',
  'official.weather.metric.oceanCurrentVelocity': 'Ocean current',
  'official.weather.metric.oceanCurrentVelocityMax': 'Maximum ocean current',
  'official.weather.metric.oceanCurrentDirection': 'Ocean current direction',
  'official.weather.metric.seaSurfaceTemperature': 'Sea surface temperature',
  'official.weather.metric.seaSurfaceTemperatureMin': 'Minimum sea surface temperature',
  'official.weather.metric.seaSurfaceTemperatureMax': 'Maximum sea surface temperature',
  'official.weather.metric.atTime': 'at {time}',
  'official.weather.metric.unavailable': '{metric}: unavailable for this location or date'
};
