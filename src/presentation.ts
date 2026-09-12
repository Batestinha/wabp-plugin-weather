import type { TranslateFn } from '@wabs/plugin-sdk/i18n';
import type {
  WeatherCurrentOutput,
  WeatherForecastOutput,
  WeatherMetricValue,
  WeatherQueryOutput
} from './serviceApi';

export function renderWeatherQuery(output: WeatherQueryOutput, t: TranslateFn, locale: string): string {
  return output.kind === 'current'
    ? renderCurrent(output.report, t, locale)
    : renderForecast(output.report, t, locale);
}

function renderCurrent(report: WeatherCurrentOutput, t: TranslateFn, locale: string): string {
  const current = report.current;
  return nonEmpty([
    t('official.weather.current.title', { location: report.location.label }),
    weatherCondition(current.weatherCode, t),
    metricLine(t, locale, 'official.weather.metric.temperature', current.temperature2m),
    metricLine(t, locale, 'official.weather.metric.apparentTemperature', current.apparentTemperature),
    metricLine(t, locale, 'official.weather.metric.relativeHumidity', current.relativeHumidity2m),
    metricLine(t, locale, 'official.weather.metric.precipitation', current.precipitation),
    metricLine(t, locale, 'official.weather.metric.windSpeed', current.windSpeed10m),
    metricLine(t, locale, 'official.weather.metric.windGust', current.windGusts10m),
    metricLine(t, locale, 'official.weather.metric.windDirection', current.windDirection10m),
    t('official.weather.current.updated', { time: current.time })
  ]).join('\n');
}

function renderForecast(report: WeatherForecastOutput, t: TranslateFn, locale: string): string {
  const days = report.days.map((day) => {
    const summary = nonEmpty([
      weatherCondition(day.weatherCode, t),
      metricLine(t, locale, 'official.weather.metric.temperatureMax', day.temperatureMax),
      metricLine(t, locale, 'official.weather.metric.temperatureMin', day.temperatureMin),
      metricLine(t, locale, 'official.weather.metric.precipitationProbability', day.precipitationProbabilityMax),
      metricLine(t, locale, 'official.weather.metric.precipitation', day.precipitationSum),
      metricLine(t, locale, 'official.weather.metric.windSpeed', day.windSpeedMax),
      metricLine(t, locale, 'official.weather.metric.windGust', day.windGustsMax)
    ]).join(' · ');
    return t('official.weather.forecast.day', {
      date: formatForecastDate(day.date, locale),
      summary: summary || t('official.weather.none')
    });
  });
  return [
    t('official.weather.forecast.title', { location: report.location.label }),
    ...days
  ].join('\n');
}

function weatherCondition(code: number | undefined, t: TranslateFn): string | undefined {
  if (code === undefined) return undefined;
  if (code === 0) return t('official.weather.condition.clear');
  if (code === 1) return t('official.weather.condition.mainlyClear');
  if (code === 2) return t('official.weather.condition.partlyCloudy');
  if (code === 3) return t('official.weather.condition.overcast');
  if (code === 45 || code === 48) return t('official.weather.condition.fog');
  if ([51, 53, 55, 56, 57].includes(code)) return t('official.weather.condition.drizzle');
  if ([61, 63, 65, 66, 67].includes(code)) return t('official.weather.condition.rain');
  if ([71, 73, 75, 77, 85, 86].includes(code)) return t('official.weather.condition.snow');
  if ([80, 81, 82].includes(code)) return t('official.weather.condition.showers');
  if ([95, 96, 99].includes(code)) return t('official.weather.condition.thunderstorm');
  return t('official.weather.condition.unknown');
}

function metricLine(
  t: TranslateFn,
  locale: string,
  key: string,
  metric?: WeatherMetricValue
): string | undefined {
  return metric ? `${t(key)}: ${formatMetric(metric, locale)}` : undefined;
}

function formatMetric(metric: WeatherMetricValue, locale: string): string {
  const value = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(metric.value);
  return metric.unit ? `${value} ${metric.unit}` : value;
}

function formatForecastDate(value: string, locale: string): string {
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC'
  }).format(date);
}

function nonEmpty(values: Array<string | undefined>): string[] {
  return values.filter((value): value is string => Boolean(value?.trim()));
}
