import type { TranslateFn } from '@wabs/plugin-sdk/i18n';
import type { WeatherMetricValue } from './serviceApi';

/**
 * Number, date and condition formatting shared by every weather message, so
 * /weather, the assistant and Community Events print values the same way.
 */

export type WeatherConditionKind =
  | 'clear'
  | 'mainlyClear'
  | 'partlyCloudy'
  | 'overcast'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'snow'
  | 'showers'
  | 'thunderstorm'
  | 'unknown';

const CONDITION_EMOJI: Record<WeatherConditionKind, string> = {
  clear: '☀️',
  mainlyClear: '🌤️',
  partlyCloudy: '⛅',
  overcast: '☁️',
  fog: '🌫️',
  drizzle: '🌦️',
  rain: '🌧️',
  snow: '🌨️',
  showers: '🌦️',
  thunderstorm: '⛈️',
  unknown: '❔'
};

const COMPASS_POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/** WMO weather interpretation codes, as returned by Open-Meteo. */
export function weatherConditionKind(code: number): WeatherConditionKind {
  if (code === 0) return 'clear';
  if (code === 1) return 'mainlyClear';
  if (code === 2) return 'partlyCloudy';
  if (code === 3) return 'overcast';
  if (code === 45 || code === 48) return 'fog';
  if ([51, 53, 55, 56, 57].includes(code)) return 'drizzle';
  if ([61, 63, 65, 66, 67].includes(code)) return 'rain';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snow';
  if ([80, 81, 82].includes(code)) return 'showers';
  if ([95, 96, 99].includes(code)) return 'thunderstorm';
  return 'unknown';
}

export function weatherConditionEmoji(kind: WeatherConditionKind, isDay = true): string {
  if (!isDay && (kind === 'clear' || kind === 'mainlyClear')) return '🌙';
  if (!isDay && kind === 'partlyCloudy') return '☁️';
  return CONDITION_EMOJI[kind];
}

/** Rounds to `fractionDigits`; `fixed` keeps trailing zeros so a column of heights lines up ("3,0 m" beside "2,7 m"). */
export function formatNumber(value: number, locale: string, fractionDigits: number, fixed = false): string {
  const rounded = Number(value.toFixed(fractionDigits));
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: fixed ? fractionDigits : 0,
    maximumFractionDigits: fractionDigits
  }).format(Object.is(rounded, -0) ? 0 : rounded);
}

export function formatQuantity(metric: WeatherMetricValue, locale: string, fractionDigits: number, fixed = false): string {
  const value = formatNumber(metric.value, locale, fractionDigits, fixed);
  return metric.unit ? `${value} ${metric.unit}` : value;
}

/** "16–18 °C"; a single value when both ends round to the same number. */
export function formatRange(
  low: WeatherMetricValue,
  high: WeatherMetricValue,
  locale: string,
  fractionDigits: number
): string {
  if (low.unit !== high.unit) {
    return `${formatQuantity(low, locale, fractionDigits)}–${formatQuantity(high, locale, fractionDigits)}`;
  }
  const lowText = formatNumber(low.value, locale, fractionDigits);
  const highText = formatNumber(high.value, locale, fractionDigits);
  const value = lowText === highText ? highText : `${lowText}–${highText}`;
  return high.unit ? `${value} ${high.unit}` : value;
}

/** Eight-point compass label ("SE"), localized through the catalog ("SO" for SW in Portuguese). */
export function compassPoint(degrees: number, t: TranslateFn): string {
  const normalized = ((degrees % 360) + 360) % 360;
  const point = COMPASS_POINTS[Math.round(normalized / 45) % COMPASS_POINTS.length]!;
  return t(`official.weather.compass.${point}`);
}

/** Local clock time from an ISO-like local timestamp ("2026-11-14T04:54" -> "04h54" in Portuguese). */
export function formatClockTime(value: string, t: TranslateFn): string {
  const match = /T(\d{2}):(\d{2})/.exec(value);
  return match ? t('official.weather.time.clock', { hour: match[1], minute: match[2] }) : value;
}

/** Short day label for a local calendar date ("2026-11-14" -> "sáb, 14 nov" / "Sat 14 Nov"). */
export function formatDayLabel(value: string, locale: string, t: TranslateFn): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  if (Number.isNaN(date.getTime())) return value;
  let weekday: string;
  let month: string;
  try {
    // Intl's "short" weekday is a whole word in pt-PT; take the first three letters, as event templates do.
    weekday = Array.from(new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' })
      .format(date).normalize('NFC')).slice(0, 3).join('');
    month = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' })
      .format(date).replace(/\.$/, '');
  } catch {
    return value;
  }
  return t('official.weather.date.short', { weekday, day: String(Number(match[3])), month });
}
