import pino, { type DestinationStream, type Logger, type LoggerOptions } from 'pino';

import { censor, REDACTED_PATHS } from './redaction.ts';

/**
 * The one pino configuration for api and worker. Fastify takes these options directly, so request
 * logs go through the same redaction as application logs. Bodies are never logged in normal operation.
 *
 * @param level minimum level, from the environment (defaults to `info`)
 * @returns pino options with redaction applied
 */
export function loggerOptions(level: string = process.env['LOG_LEVEL'] ?? 'info'): LoggerOptions {
  return {
    level,
    redact: { paths: [...REDACTED_PATHS], censor },
    base: null,
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
  };
}

/**
 * A pino logger built from `loggerOptions`. Fastify takes it as `loggerInstance`, so request logs and
 * application logs share one configuration.
 *
 * @param destination where lines are written — stdout by default; tests pass a stream to inspect output
 * @returns the logger
 */
export function createLogger(destination?: DestinationStream): Logger {
  return destination === undefined ? pino(loggerOptions()) : pino(loggerOptions(), destination);
}
