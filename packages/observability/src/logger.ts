import pino, { type DestinationStream, type Logger, type LoggerOptions } from 'pino';

import { sanitize } from './redaction.ts';
import { errorDiagnostic, requestDiagnostic, responseDiagnostic } from './serializers.ts';

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

// pino calls formatters.log BEFORE its serializers, so the reduction happens here: req, res and err
// become their safe diagnostics first (a Fastify request is large and keeps routeOptions on its
// prototype), then everything left is sanitised at any depth.
function formatLog(object: Record<string, unknown>): Record<string, unknown> {
  const reduced: Record<string, unknown> = { ...object };
  if (reduced['req'] !== undefined) reduced['req'] = requestDiagnostic(reduced['req'] as object);
  if (reduced['res'] !== undefined) reduced['res'] = responseDiagnostic(reduced['res'] as object);
  if (reduced['err'] !== undefined) reduced['err'] = errorDiagnostic(reduced['err']);
  return sanitize(reduced) as Record<string, unknown>;
}

/**
 * The one pino configuration for api and worker. Errors, requests and responses are reduced to safe
 * diagnostics and every other field is sanitised at any depth. The level is validated by the caller's
 * config — this never reads the environment, so an invalid value cannot reach pino's error message.
 *
 * @param level a validated log level
 * @returns pino options
 */
export function loggerOptions(level: LogLevel): LoggerOptions {
  return {
    level,
    base: null,
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
    formatters: { log: formatLog },
  };
}

/**
 * A pino logger built from `loggerOptions`. Fastify takes it as `loggerInstance`, so request logs and
 * application logs share one configuration.
 *
 * @param level       a validated log level
 * @param destination where lines are written — stdout by default; tests pass a stream to read them
 * @returns the logger
 */
export function createLogger(level: LogLevel, destination?: DestinationStream): Logger {
  return destination === undefined
    ? pino(loggerOptions(level))
    : pino(loggerOptions(level), destination);
}
