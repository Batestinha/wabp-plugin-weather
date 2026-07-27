import type { CommandMetadata } from '../../../adminBot/router/commandMetadata';
import type { CommandContext } from '../../../adminBot/router/commandRouter';
import { tokenizeArgs } from '../../../adminBot/router/commandParser';
import type { PluginCommandContext } from '../../../platform/pluginRuntime/types';
import { requireScopeId } from '../shared';
import { WEATHER_PLUGIN_ID } from './manifest';
import { renderWeatherQuery } from './presentation';
import {
  WEATHER_MAX_DAY_OFFSET,
  WEATHER_QUERY_METHOD,
  WEATHER_SERVICE_ID,
  type WeatherDaySelection,
  type WeatherQueryOutput
} from './serviceApi';

type WeatherRequestParseResult =
  | { ok: true; location: string; selection?: WeatherDaySelection | undefined }
  | { ok: false; reason: 'missing_location' | 'invalid_selection' };

const DAY_SELECTOR_CANDIDATE_PATTERN = /^[\d-]+$/;
const DAY_SELECTOR_PATTERN = /^(\d+)(?:-(\d+))?$/;

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
      const output = await context.services.call<WeatherQueryOutput>({
        serviceId: WEATHER_SERVICE_ID,
        method: WEATHER_QUERY_METHOD,
        scopeId: requireScopeId(ctx),
        actorWid: ctx.actor?.wid ?? ctx.message.senderWid,
        ...(ctx.groupId ? { groupId: ctx.groupId } : {}),
        ...(ctx.groupWid ? { groupWid: ctx.groupWid } : {}),
        input: {
          location: parsed.location,
          ...(parsed.selection ? { selection: parsed.selection } : {}),
          language: ctx.locale,
          includeMarine: false
        }
      });
      return {
        handled: true,
        text: renderWeatherQuery(output, ctx.t, ctx.locale)
      };
    } catch {
      return failed(ctx);
    }
  });
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
      descriptionKey: 'official.weather.help.command',
      usage: '/weather {location} [day|range]'
    },
    assistant: {
      intentTags: ['weather', 'forecast', 'location'],
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
