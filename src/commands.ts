import type { CommandMetadata } from '@wabs/plugin-sdk/command-metadata';
import type { CommandContext } from '@wabs/plugin-sdk/commands';
import { tokenizeArgs } from '@wabs/plugin-sdk/command-parser';
import type { TranslateFn } from '@wabs/plugin-sdk/i18n';
import type { PluginCommandContext } from '@wabs/plugin-sdk/command-plugin';
import { requireStableIdentityAddress } from '@wabs/plugin-sdk/message-actor';
import { requireScopeId } from '@wabs/plugin-sdk/commands';
import { WEATHER_PLUGIN_ID } from './manifest';
import { renderMarineForecast } from './marineForecast';
import { renderWeatherQuery } from './presentation';
import {
  WEATHER_MAX_DAY_OFFSET,
  WEATHER_QUERY_METHOD,
  WEATHER_SERVICE_ID,
  type WeatherDaySelection,
  type WeatherQueryInput,
  type WeatherQueryOutput
} from './serviceApi';

type WeatherRequestParseResult =
  | { ok: true; location: string; selection?: WeatherDaySelection | undefined }
  | { ok: false; reason: 'missing_location' | 'invalid_selection' };

export interface WeatherRequest {
  location: string;
  selection?: WeatherDaySelection | undefined;
}

export interface WeatherRequestContext {
  scopeId: string;
  actorIdentityId: string;
  actorWid: string;
  locale: string;
  t: TranslateFn;
  groupId?: string | undefined;
  groupWid?: string | undefined;
  managementMode?: 'OBSERVE' | 'ASSIST' | 'MANAGE' | undefined;
  signal?: AbortSignal | undefined;
}

const DAY_SELECTOR_CANDIDATE_PATTERN = /^[\d-]+$/;
const DAY_SELECTOR_PATTERN = /^(\d+)(?:-(\d+))?$/;
const CURRENT_MARINE_SELECTION: WeatherDaySelection = { startDay: 0, endDay: 0 };
const MARINE_ONLY_METRIC_OVERRIDES = {
  temperature: false,
  apparentTemperature: false,
  relativeHumidity: false,
  wind: false,
  precipitation: false,
  weatherCode: false
} satisfies NonNullable<WeatherQueryInput['metrics']>;

export function registerWeatherCommands(context: PluginCommandContext): void {
  context.router.register('weather', '*', weatherCommand(), async (ctx) => {
    const parsed = parseWeatherRequest(ctx.command.rawArgs);
    if (!parsed.ok) {
      return {
        handled: true,
        text: ctx.t(parsed.reason === 'missing_location'
          ? 'official.weather.locationRequired'
          : 'official.weather.invalidSelection', {
          maxDay: WEATHER_MAX_DAY_OFFSET
        })
      };
    }
    if (!context.services) {
      return failed(ctx);
    }
    try {
      return {
        handled: true,
        text: await executeWeatherRequest(context, parsed, weatherRequestContext(ctx))
      };
    } catch {
      return failed(ctx);
    }
  });
}

export async function executeWeatherRequest(
  context: Pick<PluginCommandContext, 'services'>,
  request: WeatherRequest,
  target: WeatherRequestContext
): Promise<string> {
  const output = await callWeatherQuery(context, target, {
    location: request.location,
    ...(request.selection ? { selection: request.selection, includeMarine: 'auto' as const } : { includeMarine: false }),
    language: target.locale
  });
  const marineText = output.kind === 'forecast'
    ? renderMarineForecast(output.report, target.t, target.locale)
    : await currentMarineForecastText(context, target, request.location);
  return [
    renderWeatherQuery(output, target.t, target.locale),
    marineText
  ].filter((line): line is string => Boolean(line?.trim())).join('\n\n');
}

async function callWeatherQuery(
  context: Pick<PluginCommandContext, 'services'>,
  target: WeatherRequestContext,
  input: WeatherQueryInput
): Promise<WeatherQueryOutput> {
  if (!context.services) {
    throw new Error('Weather services are unavailable.');
  }
  return context.services.call<WeatherQueryOutput>({
    serviceId: WEATHER_SERVICE_ID,
    method: WEATHER_QUERY_METHOD,
    scopeId: target.scopeId,
    actorIdentityId: target.actorIdentityId,
    ...(target.groupId ? { groupId: target.groupId } : {}),
    ...(target.groupWid ? { groupWid: target.groupWid } : {}),
    ...(target.managementMode ? { managementMode: target.managementMode } : {}),
    input,
    ...(target.signal ? { signal: target.signal } : {})
  });
}

async function currentMarineForecastText(
  context: Pick<PluginCommandContext, 'services'>,
  target: WeatherRequestContext,
  location: string
): Promise<string | undefined> {
  try {
    const output = await callWeatherQuery(context, target, {
      location,
      selection: CURRENT_MARINE_SELECTION,
      language: target.locale,
      includeMarine: 'auto',
      metrics: MARINE_ONLY_METRIC_OVERRIDES
    });
    return output.kind === 'forecast'
      ? renderMarineForecast(output.report, target.t, target.locale)
      : undefined;
  } catch {
    return undefined;
  }
}

function weatherRequestContext(ctx: CommandContext): WeatherRequestContext {
  if (!ctx.actor) {
    throw new Error('Weather requests require an authoritative message actor.');
  }
  const actor = requireStableIdentityAddress(ctx.actor);
  return {
    scopeId: requireScopeId(ctx),
    actorIdentityId: actor.identityId,
    actorWid: actor.canonicalWid,
    locale: ctx.locale,
    t: ctx.t,
    ...(ctx.groupId ? { groupId: ctx.groupId } : {}),
    ...(ctx.groupWid ? { groupWid: ctx.groupWid } : {}),
    ...(ctx.managementMode ? { managementMode: ctx.managementMode } : {}),
    ...(ctx.signal ? { signal: ctx.signal } : {})
  };
}

export function parseWeatherRequest(rawArgs: string): WeatherRequestParseResult {
  const tokens = tokenizeArgs(rawArgs);
  if (tokens.length === 0) {
    return { ok: false, reason: 'missing_location' };
  }
  let selection: WeatherDaySelection | undefined;
  if (tokens.length > 1) {
    const candidate = tokens.at(-1)!;
    if (DAY_SELECTOR_CANDIDATE_PATTERN.test(candidate)) {
      selection = parseDaySelection(candidate);
      if (!selection) {
        return { ok: false, reason: 'invalid_selection' };
      }
      tokens.pop();
    }
  }
  const location = tokens.join(' ').trim();
  return location
    ? { ok: true, location, ...(selection ? { selection } : {}) }
    : { ok: false, reason: 'missing_location' };
}

export function parseDaySelection(value: string): WeatherDaySelection | undefined {
  const match = DAY_SELECTOR_PATTERN.exec(value);
  if (!match) {
    return undefined;
  }
  const startDay = Number.parseInt(match[1]!, 10);
  const endDay = match[2] === undefined ? startDay : Number.parseInt(match[2], 10);
  if (
    !Number.isInteger(startDay) ||
    !Number.isInteger(endDay) ||
    startDay < 0 ||
    endDay < startDay ||
    endDay > WEATHER_MAX_DAY_OFFSET
  ) {
    return undefined;
  }
  return { startDay, endDay };
}

function weatherCommand(): CommandMetadata {
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
      featureId: 'weather',
      topicId: 'weather-forecast',
      titleKey: 'official.weather.help.forecast.title',
      descriptionKey: 'official.weather.help.command',
      usage: '/weather {location} [day|range]',
      exampleKeys: ['official.weather.help.forecast.example.current', 'official.weather.help.forecast.example.range'],
      aliases: ['forecast'],
      keywords: ['weather', 'forecast', 'location', 'temperature', 'rain']
    },
    assistant: {
      summary: 'Query current weather or forecasts. Forecast days are numeric offsets: 0 is today, 1 is tomorrow, and 0-5 is an inclusive range.',
      intentTags: ['weather', 'forecast', 'location'],
      argumentHints: ['<location>', '[day offset 0-15 or inclusive range such as 0-5]'],
      examples: ['/weather São Pedro de Sintra 1', '/weather Sintra 0-5'],
      executable: true,
      requiresConfirmation: false
    }
  };
}

function failed(ctx: CommandContext) {
  return {
    handled: true,
    text: ctx.t('official.weather.failed')
  };
}
