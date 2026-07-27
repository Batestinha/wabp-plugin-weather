import type { CommandMetadata } from '../../../adminBot/router/commandMetadata';
import type { CommandContext } from '../../../adminBot/router/commandRouter';
import type { CommandResponse } from '../../../adminBot/router/responseDispatcher';
import type { TranslateFn } from '../../../platform/i18n';
import type { PluginCommandContext } from '../../../platform/pluginRuntime/types';
import { requireOfficialCommandRuntime, requireScopeId } from '../shared';
import { parseWeatherConfig } from './config';
import { WEATHER_PLUGIN_ID } from './manifest';
import {
  WEATHER_CURRENT_METHOD,
  WEATHER_FORECAST_METHOD,
  WEATHER_MARINE_METHOD,
  WEATHER_SERVICE_ID,
  type WeatherCurrentOutput,
  type WeatherForecastOutput,
  type WeatherMarineOutput,
  type WeatherMetricValue
} from './serviceApi';

export function registerWeatherCommands(context: PluginCommandContext): void {
  const router = context.router;

  router.register('weather', '*', weatherCommand('/weather', 'official.weather.help.current'), async (ctx) => {
    if (ctx.command.args.length > 0) {
      return { handled: true, text: ctx.t('official.weather.usage') };
    }
    return currentWeather(context, ctx);
  });
  router.register('weather', 'current', weatherCommand('/weather current', 'official.weather.help.current'), async (ctx) =>
    currentWeather(context, ctx)
  );
  router.register('weather', 'forecast', weatherCommand('/weather forecast [days]', 'official.weather.help.forecast'), async (ctx) =>
    forecastWeather(context, ctx)
  );
  router.register('weather', 'marine', weatherCommand('/weather marine', 'official.weather.help.marine'), async (ctx) =>
    marineWeather(context, ctx)
  );
}

function weatherCommand(usage: string, descriptionKey: string): CommandMetadata {
  return {
    plane: 'group_operation',
    interaction: 'group_same_chat',
    pluginId: WEATHER_PLUGIN_ID,
    requiredAccessPlane: 'group_member',
    requiresManagedGroup: true,
    targets: [{ kind: 'scope', flag: ['scope', 'scope-id'], fallback: 'current_scope' }],
    mutation: 'none',
    help: {
      familyKey: 'official.weather.help.family',
      descriptionKey,
      usage
    },
    assistant: {
      intentTags: usage.replace(/^\//, '').split(/\s+/).filter((part) => !part.startsWith('[')).slice(0, 3),
      executable: true,
      requiresConfirmation: false
    }
  };
}

async function currentWeather(context: PluginCommandContext, ctx: CommandContext) {
  const runtime = requireOfficialCommandRuntime(context);
  const scopeId = requireScopeId(ctx);
  const config = parseWeatherConfig(await runtime.configFor(scopeId, ctx.actor?.wid ?? ctx.message.senderWid));
  if (!config.enabled) {
    return { handled: true, text: ctx.t('official.weather.disabled') };
  }
  try {
    const report = await callWeatherService<WeatherCurrentOutput>(context, ctx, WEATHER_CURRENT_METHOD, {});
    return {
      handled: true,
      response: textResponses(renderCurrentWeatherMessages(report, ctx.t, ctx.locale))
    };
  } catch (error) {
    return failed(ctx, error);
  }
}

async function forecastWeather(context: PluginCommandContext, ctx: CommandContext) {
  const runtime = requireOfficialCommandRuntime(context);
  const scopeId = requireScopeId(ctx);
  const config = parseWeatherConfig(await runtime.configFor(scopeId, ctx.actor?.wid ?? ctx.message.senderWid));
  if (!config.enabled) {
    return { handled: true, text: ctx.t('official.weather.disabled') };
  }
  const days = parseForecastDays(ctx.command.args[0]);
  if (ctx.command.args[0] && days === undefined) {
    return { handled: true, text: ctx.t('official.weather.usage') };
  }
  try {
    const report = await callWeatherService<WeatherForecastOutput>(context, ctx, WEATHER_FORECAST_METHOD, {
      ...(days ? { days } : {})
    });
    return {
      handled: true,
      response: textResponses(renderForecastMessages(report, ctx.t, ctx.locale))
    };
  } catch (error) {
    return failed(ctx, error);
  }
}

async function marineWeather(context: PluginCommandContext, ctx: CommandContext) {
  const runtime = requireOfficialCommandRuntime(context);
  const scopeId = requireScopeId(ctx);
  const config = parseWeatherConfig(await runtime.configFor(scopeId, ctx.actor?.wid ?? ctx.message.senderWid));
  if (!config.enabled) {
    return { handled: true, text: ctx.t('official.weather.disabled') };
  }
  try {
    const report = await callWeatherService<WeatherMarineOutput>(context, ctx, WEATHER_MARINE_METHOD, {});
    return { handled: true, text: renderMarine(report, ctx.t, ctx.locale) };
  } catch (error) {
    return failed(ctx, error);
  }
}

async function callWeatherService<Output>(
  context: PluginCommandContext,
  ctx: CommandContext,
  method: string,
  input: unknown
): Promise<Output> {
  if (!context.services) {
    throw new Error('Plugin services are unavailable in this runtime.');
  }
  return context.services.call<Output>({
    serviceId: WEATHER_SERVICE_ID,
    method,
    scopeId: requireScopeId(ctx),
    actorWid: ctx.actor?.wid ?? ctx.message.senderWid,
    ...(ctx.groupId ? { groupId: ctx.groupId } : {}),
    ...(ctx.groupWid ? { groupWid: ctx.groupWid } : {}),
    input
  });
}

function failed(ctx: CommandContext, error: unknown) {
  return {
    handled: true,
    text: ctx.t('official.weather.failed', {
      reason: error instanceof Error ? error.message : String(error)
    })
  };
}

export function renderCurrentWeather(report: WeatherCurrentOutput, t: TranslateFn, locale: string): string {
  const lines = [
    t('official.weather.current.title', { location: report.location.label }),
    ...currentLines(report.current, t, locale),
    t('official.weather.current.updated', { time: report.current.time })
  ];
  return nonEmpty(lines).join('\n');
}

export function renderCurrentWeatherMessages(
  report: WeatherCurrentOutput,
  t: TranslateFn,
  locale: string
): string[] {
  return nonEmpty([
    renderCurrentWeather(report, t, locale),
    report.marine
      ? renderMarine({
          provider: report.provider,
          fetchedAt: report.fetchedAt,
          location: report.location,
          units: report.units,
          marine: report.marine
        }, t, locale)
      : undefined
  ]);
}

export function renderForecast(report: WeatherForecastOutput, t: TranslateFn, locale: string): string {
  const lines = [
    t('official.weather.forecast.title', { location: report.location.label }),
    ...report.days.map((day) => t('official.weather.forecast.day', {
      date: day.date,
      summary: nonEmpty([
        metricLine(t, locale, 'official.weather.metric.temperatureMax', day.temperatureMax),
        metricLine(t, locale, 'official.weather.metric.temperatureMin', day.temperatureMin),
        metricLine(t, locale, 'official.weather.metric.relativeHumidityMax', day.relativeHumidityMax),
        metricLine(t, locale, 'official.weather.metric.relativeHumidityMin', day.relativeHumidityMin),
        metricLine(t, locale, 'official.weather.metric.relativeHumidityMean', day.relativeHumidityMean),
        metricLine(t, locale, 'official.weather.metric.precipitation', day.precipitationSum),
        metricLine(t, locale, 'official.weather.metric.precipitationProbability', day.precipitationProbabilityMax),
        metricLine(t, locale, 'official.weather.metric.windSpeed', day.windSpeedMax),
        metricLine(t, locale, 'official.weather.metric.windGust', day.windGustsMax),
        metricLine(t, locale, 'official.weather.metric.windDirection', day.windDirectionDominant),
        day.weatherCode !== undefined ? `${t('official.weather.metric.weatherCode')}: ${day.weatherCode}` : undefined
      ]).join(', ') || t('official.weather.none')
    }))
  ];
  return nonEmpty(lines).join('\n');
}

export function renderForecastMessages(
  report: WeatherForecastOutput,
  t: TranslateFn,
  locale: string
): string[] {
  return nonEmpty([
    renderForecast(report, t, locale),
    renderMarineForecast(report, t, locale)
  ]);
}

export function renderMarineForecast(
  report: WeatherForecastOutput,
  t: TranslateFn,
  locale: string
): string | undefined {
  const sections = report.days
    .map((day) => marineForecastDayLines(report.location.label, day, t, locale))
    .filter((lines) => lines.length > 0);
  return sections.length > 0
    ? sections.map((lines) => lines.join('\n')).join('\n\n')
    : undefined;
}

export function renderMarine(report: WeatherMarineOutput, t: TranslateFn, locale: string): string {
  const lines = [
    t('official.weather.marine.title', { location: report.location.label }),
    ...marineLines(report.marine, t, locale),
    t('official.weather.current.updated', { time: report.marine.time })
  ];
  return nonEmpty(lines).join('\n');
}

function marineForecastDayLines(
  location: string,
  day: WeatherForecastOutput['days'][number],
  t: TranslateFn,
  locale: string
): string[] {
  const marine = day.marine;
  if (!marine || marine.requested.length === 0) {
    return [];
  }
  const lines: Array<string | undefined> = [];
  const tideRequested = marine.requested.includes('tide');
  if (tideRequested) {
    lines.push(t('official.weather.tideTimes.title', {
      place: location,
      startDate: formatForecastDate(day.date)
    }));
    if (marine.unavailable.includes('tide')) {
      lines.push(t('official.weather.metric.unavailable', {
        metric: t('official.weather.metric.tide')
      }));
    } else {
      lines.push(...marine.tideEvents.map((event) => t(
        event.type === 'high'
          ? 'official.weather.tideTimes.high'
          : 'official.weather.tideTimes.low',
        {
          time: formatTideTime(event.time),
          height: formatMetric(event.height, locale, 2)
        }
      )));
    }
  } else {
    lines.push(t('official.weather.marine.forecastTitle', {
      location,
      date: formatForecastDate(day.date)
    }));
  }

  if (marine.requested.includes('wave')) {
    lines.push(
      marine.unavailable.includes('wave')
        ? t('official.weather.metric.unavailable', { metric: t('official.weather.metric.wave') })
        : nonEmpty([
            metricLine(t, locale, 'official.weather.metric.waveHeightMax', marine.waveHeightMax),
            metricLine(t, locale, 'official.weather.metric.waveDirection', marine.waveDirectionDominant),
            metricLine(t, locale, 'official.weather.metric.wavePeriodMax', marine.wavePeriodMax)
          ]).join(', ')
    );
  }
  if (marine.requested.includes('oceanCurrent')) {
    lines.push(
      marine.unavailable.includes('oceanCurrent')
        ? t('official.weather.metric.unavailable', { metric: t('official.weather.metric.oceanCurrentVelocity') })
        : nonEmpty([
            metricLine(t, locale, 'official.weather.metric.oceanCurrentVelocityMax', marine.oceanCurrentVelocityMax),
            metricLine(t, locale, 'official.weather.metric.oceanCurrentDirection', marine.oceanCurrentDirectionAtMax),
            marine.oceanCurrentTime
              ? t('official.weather.metric.atTime', { time: formatTideTime(marine.oceanCurrentTime) })
              : undefined
          ]).join(', ')
    );
  }
  if (marine.requested.includes('seaSurfaceTemperature')) {
    lines.push(
      marine.unavailable.includes('seaSurfaceTemperature')
        ? t('official.weather.metric.unavailable', { metric: t('official.weather.metric.seaSurfaceTemperature') })
        : nonEmpty([
            metricLine(t, locale, 'official.weather.metric.seaSurfaceTemperatureMin', marine.seaSurfaceTemperatureMin),
            metricLine(t, locale, 'official.weather.metric.seaSurfaceTemperatureMax', marine.seaSurfaceTemperatureMax)
          ]).join(', ')
    );
  }
  return nonEmpty(lines);
}

function currentLines(current: WeatherCurrentOutput['current'], t: TranslateFn, locale: string): Array<string | undefined> {
  return [
    metricLine(t, locale, 'official.weather.metric.temperature', current.temperature2m),
    metricLine(t, locale, 'official.weather.metric.apparentTemperature', current.apparentTemperature),
    metricLine(t, locale, 'official.weather.metric.relativeHumidity', current.relativeHumidity2m),
    metricLine(t, locale, 'official.weather.metric.precipitation', current.precipitation),
    metricLine(t, locale, 'official.weather.metric.windSpeed', current.windSpeed10m),
    metricLine(t, locale, 'official.weather.metric.windDirection', current.windDirection10m),
    metricLine(t, locale, 'official.weather.metric.windGust', current.windGusts10m),
    current.weatherCode !== undefined ? `${t('official.weather.metric.weatherCode')}: ${current.weatherCode}` : undefined
  ];
}

function marineLines(marine: WeatherMarineOutput['marine'], t: TranslateFn, locale: string): Array<string | undefined> {
  return [
    metricLine(t, locale, 'official.weather.metric.tide', marine.seaLevelHeightMsl),
    metricLine(t, locale, 'official.weather.metric.waveHeight', marine.waveHeight),
    metricLine(t, locale, 'official.weather.metric.waveDirection', marine.waveDirection),
    metricLine(t, locale, 'official.weather.metric.wavePeriod', marine.wavePeriod),
    metricLine(t, locale, 'official.weather.metric.oceanCurrentVelocity', marine.oceanCurrentVelocity),
    metricLine(t, locale, 'official.weather.metric.oceanCurrentDirection', marine.oceanCurrentDirection),
    metricLine(t, locale, 'official.weather.metric.seaSurfaceTemperature', marine.seaSurfaceTemperature)
  ];
}

function metricLine(t: TranslateFn, locale: string, key: string, metric?: WeatherMetricValue | undefined): string | undefined {
  return metric ? `${t(key)}: ${formatMetric(metric, locale)}` : undefined;
}

function formatMetric(metric: WeatherMetricValue, locale: string, fractionDigits = 1): string {
  const value = new Intl.NumberFormat(locale, {
    minimumFractionDigits: fractionDigits === 2 ? 2 : 0,
    maximumFractionDigits: fractionDigits
  }).format(metric.value);
  return metric.unit ? `${value} ${metric.unit}` : value;
}

function formatTideTime(value: string): string {
  const match = /T(\d{2}):(\d{2})/.exec(value);
  return match ? `${match[1]}h${match[2]}` : value;
}

function formatForecastDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : value;
}

function textResponses(texts: string[]): CommandResponse {
  return texts.length === 1
    ? { kind: 'text', text: texts[0]! }
    : {
        kind: 'multi',
        responses: texts.map((text) => ({ kind: 'text', text }))
      };
}

function parseForecastDays(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 16 ? parsed : undefined;
}

function nonEmpty(values: Array<string | undefined>): string[] {
  return values.filter((value): value is string => Boolean(value?.trim()));
}
