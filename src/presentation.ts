import type { TranslateFn } from '@wabs/plugin-sdk/i18n';
import type { WeatherPresentationStyle } from './config';
import {
  compassPoint,
  formatClockTime,
  formatDayLabel,
  formatQuantity,
  formatRange,
  weatherConditionEmoji,
  weatherConditionKind
} from './format';
import type {
  WeatherCurrentOutput,
  WeatherForecastOutput,
  WeatherMetricValue,
  WeatherPresentation,
  WeatherPresentedCondition,
  WeatherPresentedDay,
  WeatherQueryOutput,
  WeatherTideContext
} from './serviceApi';

/**
 * The one weather message renderer. /weather, the assistant tool and other
 * plugins (through the `present` service method) all send this text, so a
 * forecast reads the same wherever it appears.
 */

export interface WeatherPresentationContext {
  t: TranslateFn;
  locale: string;
  style: WeatherPresentationStyle;
}

type ForecastDay = WeatherForecastOutput['days'][number];
type MarineDay = NonNullable<ForecastDay['marine']>;

const EMOJI = {
  temperature: '🌡️',
  humidity: '💧',
  rain: '☔',
  wind: '💨',
  tide: '🌊',
  tideHigh: '⬆️',
  tideLow: '⬇️',
  waves: '🏄',
  oceanCurrent: '🧭'
} as const;

const TIDES_PER_LINE = 2;

export function presentWeather(
  output: WeatherQueryOutput,
  context: WeatherPresentationContext,
  todayMarine?: WeatherForecastOutput | undefined
): WeatherPresentation {
  return output.kind === 'current'
    ? presentCurrent(output.report, context, todayMarine)
    : presentForecast(output.report, context);
}

function presentCurrent(
  report: WeatherCurrentOutput,
  context: WeatherPresentationContext,
  todayMarine?: WeatherForecastOutput | undefined
): WeatherPresentation {
  const { t } = context;
  const current = report.current;
  const condition = presentCondition(current.weatherCode, context, current.isDay);
  const weatherLines = nonEmpty([
    condition ? conditionLine(condition, context) : undefined,
    joinParts([
      part(context, EMOJI.temperature, 'official.weather.label.temperature', currentTemperature(current, context)),
      part(context, EMOJI.humidity, 'official.weather.label.humidity', quantity(current.relativeHumidity2m, context, 0))
    ]),
    part(context, EMOJI.rain, 'official.weather.label.rain', quantity(current.precipitation, context, 1)),
    part(context, EMOJI.wind, 'official.weather.label.wind', windText(
      current.windSpeed10m,
      current.windDirection10m,
      current.windGusts10m,
      context
    ))
  ]);
  const marineDay = todayMarine?.days[0]?.marine;
  const marineLines = marineDay ? marineDayLines(marineDay, context) : [];
  const weatherText = weatherLines.join('\n') || t('official.weather.none');
  const marineText = marineLines.join('\n') || undefined;
  const footnote = nonEmpty([
    current.time && current.time !== 'unknown'
      ? italic(t('official.weather.footnote.updated', { time: formatClockTime(current.time, t) }))
      : undefined,
    marineDay && hasTideEvents(marineDay) ? tideFootnote(todayMarine?.tideContext, context) : undefined
  ]).join('\n') || undefined;
  const body = joinLines([weatherText, marineText]);
  const title = t('official.weather.title.current', { location: report.location.label });
  return {
    locale: context.locale,
    style: context.style,
    title,
    current: {
      ...(condition ? { condition } : {}),
      weatherText,
      ...(marineText ? { marineText } : {}),
      text: body
    },
    days: [],
    ...(footnote ? { footnote } : {}),
    text: [joinLines([title, body]), footnote].filter(Boolean).join('\n\n')
  };
}

function presentForecast(report: WeatherForecastOutput, context: WeatherPresentationContext): WeatherPresentation {
  const { t } = context;
  const days = report.days.map((day) => presentForecastDay(day, context));
  const tidesShown = report.days.some((day) => day.marine && hasTideEvents(day.marine));
  const footnote = tidesShown ? tideFootnote(report.tideContext, context) : undefined;
  const title = t('official.weather.title.forecast', { location: report.location.label });
  const sections = days.map((day) => joinLines([t('official.weather.day.heading', { date: day.label }), day.text]));
  return {
    locale: context.locale,
    style: context.style,
    title,
    days,
    ...(footnote ? { footnote } : {}),
    text: [title, ...sections, footnote].filter(Boolean).join('\n\n')
  };
}

export function presentForecastDay(day: ForecastDay, context: WeatherPresentationContext): WeatherPresentedDay {
  const { t } = context;
  const condition = presentCondition(day.weatherCode, context);
  const weatherLines = nonEmpty([
    condition ? conditionLine(condition, context) : undefined,
    joinParts([
      part(context, EMOJI.temperature, 'official.weather.label.temperature', temperatureRange(day.temperatureMin, day.temperatureMax, context)),
      part(context, EMOJI.humidity, 'official.weather.label.humidity', humidityRange(day, context))
    ]),
    part(context, EMOJI.rain, 'official.weather.label.rain', joinParts([
      quantity(day.precipitationProbabilityMax, context, 0),
      quantity(day.precipitationSum, context, 1)
    ])),
    part(context, EMOJI.wind, 'official.weather.label.wind', windText(
      day.windSpeedMax,
      day.windDirectionDominant,
      day.windGustsMax,
      context
    ))
  ]);
  const marineLines = day.marine ? marineDayLines(day.marine, context) : [];
  const weatherText = weatherLines.join('\n') || t('official.weather.none');
  const marineText = marineLines.join('\n') || undefined;
  return {
    date: day.date,
    label: formatDayLabel(day.date, context.locale, t),
    ...(condition ? { condition } : {}),
    weatherText,
    ...(marineText ? { marineText } : {}),
    text: joinLines([weatherText, marineText])
  };
}

function marineDayLines(marine: MarineDay, context: WeatherPresentationContext): string[] {
  const { t, locale } = context;
  const lines: Array<string | undefined> = [];
  if (marine.requested.includes('tide')) {
    if (marine.unavailable.includes('tide')) {
      lines.push(unavailableLine(context, EMOJI.tide, 'official.weather.label.tides'));
    } else {
      lines.push(...tideLines(marine, context));
    }
  }
  if (marine.requested.includes('wave')) {
    lines.push(marine.unavailable.includes('wave')
      ? unavailableLine(context, EMOJI.waves, 'official.weather.label.waves')
      : part(context, EMOJI.waves, 'official.weather.label.waves', joinParts([
          marine.waveHeightMax
            ? t('official.weather.value.upTo', { value: formatQuantity(marine.waveHeightMax, locale, 1, true) })
            : undefined,
          marine.waveDirectionDominant
            ? t('official.weather.value.from', { direction: compassPoint(marine.waveDirectionDominant.value, t) })
            : undefined,
          quantity(marine.wavePeriodMax, context, 0)
        ])));
  }
  if (marine.requested.includes('oceanCurrent')) {
    lines.push(marine.unavailable.includes('oceanCurrent')
      ? unavailableLine(context, EMOJI.oceanCurrent, 'official.weather.label.oceanCurrent')
      : part(context, EMOJI.oceanCurrent, 'official.weather.label.oceanCurrent', joinParts([
          marine.oceanCurrentVelocityMax
            ? marine.oceanCurrentDirectionAtMax
              ? t('official.weather.value.towards', {
                  speed: formatQuantity(marine.oceanCurrentVelocityMax, locale, 1),
                  direction: compassPoint(marine.oceanCurrentDirectionAtMax.value, t)
                })
              : formatQuantity(marine.oceanCurrentVelocityMax, locale, 1)
            : undefined,
          marine.oceanCurrentTime
            ? t('official.weather.value.atTime', { time: formatClockTime(marine.oceanCurrentTime, t) })
            : undefined
        ])));
  }
  if (marine.requested.includes('seaSurfaceTemperature')) {
    if (marine.unavailable.includes('seaSurfaceTemperature')) {
      lines.push(unavailableLine(context, EMOJI.temperature, 'official.weather.label.seaTemperature'));
    } else {
      const value = temperatureRange(marine.seaSurfaceTemperatureMin, marine.seaSurfaceTemperatureMax, context);
      if (value) {
        lines.push(context.style === 'emoji'
          ? `${EMOJI.temperature} ${t('official.weather.value.seaTemperature', { value })}`
          : `${t('official.weather.label.seaTemperature')}: ${value}`);
      }
    }
  }
  return nonEmpty(lines);
}

function tideLines(marine: MarineDay, context: WeatherPresentationContext): string[] {
  const { t, locale } = context;
  const events = marine.tideEvents.map((event) => {
    const time = formatClockTime(event.time, t);
    const height = formatQuantity(event.height, locale, 1, true);
    return context.style === 'emoji'
      ? `${event.type === 'high' ? EMOJI.tideHigh : EMOJI.tideLow} ${time} ${height}`
      : t(event.type === 'high' ? 'official.weather.value.tideHigh' : 'official.weather.value.tideLow', { time, height });
  });
  const lines: string[] = [];
  for (let index = 0; index < events.length; index += TIDES_PER_LINE) {
    const body = events.slice(index, index + TIDES_PER_LINE).join(' · ');
    lines.push(context.style === 'emoji'
      ? `${EMOJI.tide} ${body}`
      : `${t('official.weather.label.tides')}: ${body}`);
  }
  return lines;
}

function tideFootnote(tideContext: WeatherTideContext | undefined, context: WeatherPresentationContext): string | undefined {
  if (!tideContext) return undefined;
  const station = tideContext.station?.name ?? '';
  const key = tideContext.quality === 'crude-current-anchor'
    ? 'official.weather.footnote.tideCrude'
    : tideContext.forecastSource === 'fcul'
      ? 'official.weather.footnote.tideFcul'
      : 'official.weather.footnote.tideMsl';
  return italic(context.t(key, { station }));
}

function hasTideEvents(marine: MarineDay): boolean {
  return marine.requested.includes('tide') && !marine.unavailable.includes('tide') && marine.tideEvents.length > 0;
}

function presentCondition(
  code: number | undefined,
  context: WeatherPresentationContext,
  isDay?: boolean | undefined
): WeatherPresentedCondition | undefined {
  if (code === undefined) return undefined;
  const kind = weatherConditionKind(code);
  return {
    code,
    text: context.t(`official.weather.condition.${kind}`),
    emoji: weatherConditionEmoji(kind, isDay ?? true)
  };
}

function conditionLine(condition: WeatherPresentedCondition, context: WeatherPresentationContext): string {
  return context.style === 'emoji' ? `${condition.emoji} ${condition.text}` : condition.text;
}

function currentTemperature(current: WeatherCurrentOutput['current'], context: WeatherPresentationContext): string | undefined {
  const temperature = quantity(current.temperature2m, context, 0);
  const apparent = quantity(current.apparentTemperature, context, 0);
  const feelsLike = apparent ? context.t('official.weather.value.feelsLike', { value: apparent }) : undefined;
  if (temperature && feelsLike) return `${temperature} (${feelsLike})`;
  return temperature ?? feelsLike;
}

function temperatureRange(
  low: WeatherMetricValue | undefined,
  high: WeatherMetricValue | undefined,
  context: WeatherPresentationContext
): string | undefined {
  if (low && high) return formatRange(low, high, context.locale, 0);
  if (high) return context.t('official.weather.value.high', { value: formatQuantity(high, context.locale, 0) });
  if (low) return context.t('official.weather.value.low', { value: formatQuantity(low, context.locale, 0) });
  return undefined;
}

function humidityRange(day: ForecastDay, context: WeatherPresentationContext): string | undefined {
  if (day.relativeHumidityMin && day.relativeHumidityMax) {
    return formatRange(day.relativeHumidityMin, day.relativeHumidityMax, context.locale, 0);
  }
  return quantity(day.relativeHumidityMean ?? day.relativeHumidityMax ?? day.relativeHumidityMin, context, 0);
}

function windText(
  speed: WeatherMetricValue | undefined,
  direction: WeatherMetricValue | undefined,
  gusts: WeatherMetricValue | undefined,
  context: WeatherPresentationContext
): string | undefined {
  const { t, locale } = context;
  const speedText = speed ? formatQuantity(speed, locale, 0) : undefined;
  return joinParts([
    speedText && direction
      ? t('official.weather.value.windFrom', { speed: speedText, direction: compassPoint(direction.value, t) })
      : speedText,
    gusts ? t('official.weather.value.gusts', { speed: formatQuantity(gusts, locale, 0) }) : undefined
  ]);
}

/** One metric: "🌡️ 16–18 °C" with emoji, "Temperature: 16–18 °C" in plain text. */
function part(
  context: WeatherPresentationContext,
  emoji: string,
  labelKey: string,
  value: string | undefined
): string | undefined {
  if (!value) return undefined;
  return context.style === 'emoji' ? `${emoji} ${value}` : `${context.t(labelKey)}: ${value}`;
}

function unavailableLine(context: WeatherPresentationContext, emoji: string, labelKey: string): string {
  const text = context.t('official.weather.value.unavailable', { metric: context.t(labelKey) });
  return context.style === 'emoji' ? `${emoji} ${text}` : text;
}

function quantity(
  metric: WeatherMetricValue | undefined,
  context: WeatherPresentationContext,
  fractionDigits: number
): string | undefined {
  return metric ? formatQuantity(metric, context.locale, fractionDigits) : undefined;
}

function italic(value: string): string {
  return `_${value}_`;
}

function joinParts(values: Array<string | undefined>): string | undefined {
  return nonEmpty(values).join(' · ') || undefined;
}

function joinLines(values: Array<string | undefined>): string {
  return nonEmpty(values).join('\n');
}

function nonEmpty(values: Array<string | undefined>): string[] {
  return values.filter((value): value is string => Boolean(value?.trim()));
}
