import pino, { type Bindings, type DestinationStream, type Logger, type LoggerOptions } from 'pino';

import { sanitize } from './redaction.ts';
import { errorDiagnostic, requestDiagnostic, responseDiagnostic } from './serializers.ts';

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

// Messages are meant to be constant event names ("redis connection error"); dynamic data belongs in
// fields, where the sanitiser can see it. A message that could be carrying data — outside this charset,
// longer than 120 characters, or holding a run of 6+ digits (a PIN, a phone) — is withheld. The lint rule
// in @pospay/config also rejects template literals and concatenation as a log message.
const SAFE_MESSAGE = /^[A-Za-z0-9 _.,:'()/-]{1,120}$/;
const DIGIT_RUN = /\d{6,}/;
export const WITHHELD_MESSAGE = 'log message withheld';

const safeMessage = (message: unknown, fallback: string): string => {
  if (typeof message !== 'string') return fallback;
  return SAFE_MESSAGE.test(message) && !DIGIT_RUN.test(message) ? message : WITHHELD_MESSAGE;
};

// A log call keeps at most one object and one message. An Error (or any thrown value under `err`)
// becomes its diagnostic BEFORE pino sees it — pino would otherwise copy `err.message` into `msg`.
// Extra arguments are dropped: pino would interpolate them into `msg` (`log.info('user %s', token)`).
function normalizeArgs(args: unknown[]): [object, string] {
  const [first, second] = args;
  if (first instanceof Error)
    return [{ err: errorDiagnostic(first) }, safeMessage(second, 'error')];
  if (typeof first === 'string') return [{}, safeMessage(first, 'log')];
  const object = (
    first !== null && typeof first === 'object' ? sanitize(reduce(first)) : {}
  ) as object;
  return [object, safeMessage(second, 'log')];
}

// Fastify logs its own lines with req/res/err. They are reduced to safe diagnostics BEFORE the
// sanitiser walks anything: a Fastify request is large and keeps routeOptions on its prototype.
function reduce(object: object): object {
  const reduced: Record<string, unknown> = { ...(object as Record<string, unknown>) };
  if (reduced['req'] !== undefined) reduced['req'] = requestDiagnostic(reduced['req'] as object);
  if (reduced['res'] !== undefined) reduced['res'] = responseDiagnostic(reduced['res'] as object);
  if ('err' in reduced) reduced['err'] = errorDiagnostic(reduced['err']);
  return reduced;
}

// A second, idempotent pass on the final object — belt and braces for anything that reached pino
// without going through normalizeArgs.
const formatLog = (object: Record<string, unknown>): Record<string, unknown> =>
  sanitize(object) as Record<string, unknown>;

// Bindings are serialised by pino outside formatters.log, so they are sanitised here. The wrappers call
// pino's ORIGINAL prototype methods with the real receiver: a pino child is created with the parent as its
// prototype, so it inherits these unbound wrappers and each child keeps its own bindings — a wrapper bound
// to the root would make child.setBindings() change the root and leak context between requests.
function harden(root: Logger): Logger {
  const proto = Object.getPrototypeOf(root) as Logger;
  const originalChild = proto.child;
  const originalSetBindings = proto.setBindings;
  root.child = function child(this: Logger, bindings: Bindings, options?: object) {
    return originalChild.call(this, sanitize(bindings) as Bindings, options);
  } as Logger['child'];
  root.setBindings = function setBindings(this: Logger, bindings: Bindings) {
    originalSetBindings.call(this, sanitize(bindings) as Bindings);
  };
  return root;
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
