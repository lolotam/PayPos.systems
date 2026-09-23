import pino, { type Bindings, type DestinationStream, type Logger, type LoggerOptions } from 'pino';

import { sanitize } from './redaction.ts';
import { errorDiagnostic, requestDiagnostic, responseDiagnostic } from './serializers.ts';

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

// A log call keeps at most one object and one constant message. An Error becomes its diagnostic BEFORE
// pino sees it — pino would otherwise copy `err.message` into `msg`. Extra arguments are dropped: pino
// would interpolate them into `msg` (`log.info('user %s', token)`), where no key can be redacted.
function normalizeArgs(args: unknown[]): [object, string?] {
  const [first, second] = args;
  if (first instanceof Error) {
    return [{ err: errorDiagnostic(first) }, typeof second === 'string' ? second : 'error'];
  }
  if (typeof first === 'string') return [{}, first];
  const object = (
    first !== null && typeof first === 'object' ? sanitize(reduce(first)) : {}
  ) as object;
  return typeof second === 'string' ? [object, second] : [object];
}

// Fastify logs its own lines with req/res/err. They are reduced to safe diagnostics BEFORE the
// sanitiser walks anything: a Fastify request is large and keeps routeOptions on its prototype.
function reduce(object: object): object {
  const reduced: Record<string, unknown> = { ...(object as Record<string, unknown>) };
  if (reduced['req'] !== undefined) reduced['req'] = requestDiagnostic(reduced['req'] as object);
  if (reduced['res'] !== undefined) reduced['res'] = responseDiagnostic(reduced['res'] as object);
  if (reduced['err'] instanceof Error) reduced['err'] = errorDiagnostic(reduced['err']);
  return reduced;
}

// A second, idempotent pass on the final object — belt and braces for anything that reached pino
// without going through normalizeArgs.
const formatLog = (object: Record<string, unknown>): Record<string, unknown> =>
  sanitize(object) as Record<string, unknown>;

// Bindings are serialised by pino outside formatters.log, so they are sanitised here — for this logger
// and for every child, including the per-request children Fastify creates.
function harden(logger: Logger): Logger {
  const child = logger.child.bind(logger);
  const setBindings = logger.setBindings.bind(logger);
  logger.child = ((bindings: Bindings, options?: Parameters<Logger['child']>[1]) =>
    harden(
      child(sanitize(bindings) as Bindings, options) as unknown as Logger,
    )) as unknown as Logger['child'];
  logger.setBindings = (bindings: Bindings) => setBindings(sanitize(bindings) as Bindings);
  return logger;
}

/**
 * The one pino configuration for api and worker. Every argument is sanitised before pino reads it,
 * every line again before it is written, and bindings on every child logger. The level is validated by
 * the caller's config — this never reads the environment.
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
    hooks: {
      logMethod(args, method) {
        method.apply(this, normalizeArgs(args) as Parameters<typeof method>);
      },
    },
  };
}

/**
 * A pino logger built from `loggerOptions`, with sanitised bindings on it and on every child. Fastify
 * takes it as `loggerInstance`, so request logs and application logs share one configuration.
 *
 * @param level       a validated log level
 * @param destination where lines are written — stdout by default; tests pass a stream to read them
 * @returns the logger
 */
export function createLogger(level: LogLevel, destination?: DestinationStream): Logger {
  return harden(
    destination === undefined
      ? pino(loggerOptions(level))
      : pino(loggerOptions(level), destination),
  );
}
