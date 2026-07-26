import { z } from 'zod';
import {
  WEATHER_PRECIPITATION_UNITS,
  WEATHER_TEMPERATURE_UNITS,
  WEATHER_WIND_SPEED_UNITS
} from './config';

export const WEATHER_SERVICE_ID = 'official.weather.v1';
export const WEATHER_CURRENT_METHOD = 'current';
export const WEATHER_FORECAST_METHOD = 'forecast';
export const WEATHER_MARINE_METHOD = 'marine';

export const weatherServiceLocationSchema = z.object({
  label: z.string().trim().min(1).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  timezone: z.string().trim().min(1).optional()
}).strict();

export const weatherServiceMetricOverridesSchema = z.object({
  temperature: z.boolean().optional(),
  apparentTemperature: z.boolean().optional(),
  relativeHumidity: z.boolean().optional(),
  wind: z.boolean().optional(),
  precipitation: z.boolean().optional(),
  weatherCode: z.boolean().optional(),
  tide: z.boolean().optional(),
  wave: z.boolean().optional(),
  oceanCurrent: z.boolean().optional(),
  seaSurfaceTemperature: z.boolean().optional()
}).strict();

export const weatherCurrentInputSchema = z.object({
  location: weatherServiceLocationSchema.optional(),
  metrics: weatherServiceMetricOverridesSchema.optional(),
  includeMarine: z.boolean().optional()
}).strict().default({});

export const weatherForecastInputSchema = z.object({
  location: weatherServiceLocationSchema.optional(),
  metrics: weatherServiceMetricOverridesSchema.optional(),
  days: z.number().int().min(1).max(16).optional()
}).strict().default({});

export const weatherMarineInputSchema = z.object({
  location: weatherServiceLocationSchema.optional(),
  metrics: weatherServiceMetricOverridesSchema.optional()
}).strict().default({});

export const weatherMetricValueSchema = z.object({
  value: z.number(),
  unit: z.string()
}).strict();

export const weatherReportLocationSchema = z.object({
  label: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  timezone: z.string()
}).strict();

export const weatherReportUnitsSchema = z.object({
  temperatureUnit: z.enum(WEATHER_TEMPERATURE_UNITS),
  windSpeedUnit: z.enum(WEATHER_WIND_SPEED_UNITS),
  precipitationUnit: z.enum(WEATHER_PRECIPITATION_UNITS)
}).strict();

export const weatherCurrentConditionsSchema = z.object({
  time: z.string(),
  temperature2m: weatherMetricValueSchema.optional(),
  apparentTemperature: weatherMetricValueSchema.optional(),
  relativeHumidity2m: weatherMetricValueSchema.optional(),
  precipitation: weatherMetricValueSchema.optional(),
  weatherCode: z.number().int().optional(),
  windSpeed10m: weatherMetricValueSchema.optional(),
  windDirection10m: weatherMetricValueSchema.optional(),
  windGusts10m: weatherMetricValueSchema.optional()
}).strict();

export const weatherMarineConditionsSchema = z.object({
  time: z.string(),
  seaLevelHeightMsl: weatherMetricValueSchema.optional(),
  waveHeight: weatherMetricValueSchema.optional(),
  waveDirection: weatherMetricValueSchema.optional(),
  wavePeriod: weatherMetricValueSchema.optional(),
  oceanCurrentVelocity: weatherMetricValueSchema.optional(),
  oceanCurrentDirection: weatherMetricValueSchema.optional(),
  seaSurfaceTemperature: weatherMetricValueSchema.optional()
}).strict();

export const weatherCurrentOutputSchema = z.object({
  provider: z.literal('open-meteo'),
  fetchedAt: z.string(),
  location: weatherReportLocationSchema,
  units: weatherReportUnitsSchema,
  current: weatherCurrentConditionsSchema,
  marine: weatherMarineConditionsSchema.optional()
}).strict();

export const weatherForecastDaySchema = z.object({
  date: z.string(),
  weatherCode: z.number().int().optional(),
  temperatureMax: weatherMetricValueSchema.optional(),
  temperatureMin: weatherMetricValueSchema.optional(),
  relativeHumidityMax: weatherMetricValueSchema.optional(),
  relativeHumidityMin: weatherMetricValueSchema.optional(),
  relativeHumidityMean: weatherMetricValueSchema.optional(),
  precipitationSum: weatherMetricValueSchema.optional(),
  precipitationProbabilityMax: weatherMetricValueSchema.optional(),
  windSpeedMax: weatherMetricValueSchema.optional(),
  windGustsMax: weatherMetricValueSchema.optional(),
  windDirectionDominant: weatherMetricValueSchema.optional()
}).strict();

export const weatherForecastOutputSchema = z.object({
  provider: z.literal('open-meteo'),
  fetchedAt: z.string(),
  location: weatherReportLocationSchema,
  units: weatherReportUnitsSchema,
  days: z.array(weatherForecastDaySchema)
}).strict();

export const weatherMarineOutputSchema = z.object({
  provider: z.literal('open-meteo'),
  fetchedAt: z.string(),
  location: weatherReportLocationSchema,
  units: weatherReportUnitsSchema,
  marine: weatherMarineConditionsSchema
}).strict();

export type WeatherCurrentInput = z.infer<typeof weatherCurrentInputSchema>;
export type WeatherForecastInput = z.infer<typeof weatherForecastInputSchema>;
export type WeatherMarineInput = z.infer<typeof weatherMarineInputSchema>;
export type WeatherMetricValue = z.infer<typeof weatherMetricValueSchema>;
export type WeatherCurrentOutput = z.infer<typeof weatherCurrentOutputSchema>;
export type WeatherForecastOutput = z.infer<typeof weatherForecastOutputSchema>;
export type WeatherMarineOutput = z.infer<typeof weatherMarineOutputSchema>;
