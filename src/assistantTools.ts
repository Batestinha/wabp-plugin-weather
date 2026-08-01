import { z } from 'zod';
import { logger } from '../../../platform/logging/logger';
import type { PluginCommandContext } from '../../../platform/pluginRuntime/types';
import {
  jsonSchemaForZodObject,
  throwIfAborted,
  type AssistantTool,
  type AssistantToolContext
} from '../../../platform/nlAssistant';
import { executeWeatherRequest } from './commands';
import { WEATHER_MAX_DAY_OFFSET } from './serviceApi';
import { WEATHER_PLUGIN_ID } from './manifest';

const weatherAssistantInputSchema = z.object({
  location: z.string().trim().min(2).max(256),
  startDay: z.number().int().min(0).max(WEATHER_MAX_DAY_OFFSET).optional(),
  endDay: z.number().int().min(0).max(WEATHER_MAX_DAY_OFFSET).optional()
}).strict().superRefine((input, context) => {
  if (input.endDay !== undefined && input.startDay === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['startDay'],
      message: 'startDay is required when endDay is provided'
    });
  }
  if (input.startDay !== undefined && input.endDay !== undefined && input.startDay > input.endDay) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['startDay'],
      message: 'startDay must not be greater than endDay'
    });
  }
});

const weatherAssistantOutputSchema = z.object({
  ok: z.boolean(),
  text: z.string().min(1)
}).strict();

type WeatherAssistantInput = z.infer<typeof weatherAssistantInputSchema>;
type WeatherAssistantOutput = z.infer<typeof weatherAssistantOutputSchema>;

export function registerWeatherAssistantTools(context: PluginCommandContext): AssistantTool[] {
  return [weatherQueryTool(context)];
}

function weatherQueryTool(
  pluginContext: PluginCommandContext
): AssistantTool<WeatherAssistantInput, WeatherAssistantOutput> {
  return {
    descriptor: {
      name: 'official.weather.query',
      description: 'Query localized current weather or a forecast for a named location. Use numeric day offsets: omit startDay for current conditions, use 0 for today, 1 for tomorrow, or startDay/endDay for an inclusive range through day 15.',
      pluginId: WEATHER_PLUGIN_ID,
      inputSchema: jsonSchemaForZodObject({
        location: { type: 'string', minLength: 2, maxLength: 256 },
        startDay: { type: 'integer', minimum: 0, maximum: WEATHER_MAX_DAY_OFFSET },
        endDay: { type: 'integer', minimum: 0, maximum: WEATHER_MAX_DAY_OFFSET }
      }, ['location']),
      outputSchema: jsonSchemaForZodObject({
        ok: { type: 'boolean' },
        text: { type: 'string', minLength: 1 }
      }, ['ok', 'text']),
      mutation: 'none',
      dangerous: false,
      approval: 'never'
    },
    inputSchema: weatherAssistantInputSchema,
    outputSchema: weatherAssistantOutputSchema,
    async run(toolContext, input) {
      throwIfAborted(toolContext.signal);
      const locale = toolContext.context.responseLocale?.locale ?? 'en';
      const t = toolContext.translate ?? pluginContext.i18n.translator(locale);
      try {
        const text = await executeWeatherRequest(pluginContext, {
          location: input.location,
          ...(input.startDay !== undefined ? {
            selection: {
              startDay: input.startDay,
              endDay: input.endDay ?? input.startDay
            }
          } : {})
        }, weatherToolRequestContext(toolContext, locale, t));
        throwIfAborted(toolContext.signal);
        return { content: { ok: true, text } };
      } catch (error) {
        throwIfAborted(toolContext.signal);
        logger.warn({
          error,
          pluginId: WEATHER_PLUGIN_ID,
          scopeId: toolContext.scopeId
        }, 'Weather assistant query failed');
        return {
          content: {
            ok: false,
            text: t('official.weather.failed')
          }
        };
      }
    }
  };
}

function weatherToolRequestContext(
  context: AssistantToolContext,
  locale: string,
  t: ReturnType<PluginCommandContext['i18n']['translator']>
) {
  return {
    scopeId: context.scopeId,
    actorWid: context.actor.wid,
    locale,
    t,
    ...(context.groupId ? { groupId: context.groupId } : {}),
    ...(context.groupWid ? { groupWid: context.groupWid } : {}),
    ...(context.managementMode ? { managementMode: context.managementMode } : {}),
    ...(context.signal ? { signal: context.signal } : {})
  };
}
