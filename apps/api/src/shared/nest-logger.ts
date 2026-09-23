import type { LoggerService } from '@nestjs/common';
import type { Logger } from '@pospay/observability';

// Nest's own messages go through the sanitising pino logger instead of Nest's console logger, which
// would print initialisation errors and their stacks raw. Framework info lines (route mapping, module
// init) keep their text; warnings and errors keep only their context — their text can be an exception
// message carrying a connection string.
// Nest's error(message, stack) overload puts a stack where a context would be, so only a string that
// looks like a class name ("InstanceLoader") is kept as context; anything else is discarded.
const CONTEXT = /^[A-Z][A-Za-z0-9]{0,60}$/;
const contextOf = (params: unknown[]): string | undefined => {
  const last = params.at(-1);
  return typeof last === 'string' && CONTEXT.test(last) ? last : undefined;
};

/**
 * A Nest `LoggerService` over the shared pino logger.
 */
export class PinoNestLogger implements LoggerService {
  readonly #logger: Logger;

  constructor(logger: Logger) {
    this.#logger = logger;
  }

  log(message: unknown, ...params: unknown[]): void {
    this.#logger.debug({ nest: contextOf(params) }, typeof message === 'string' ? message : 'nest');
  }

  warn(_message: unknown, ...params: unknown[]): void {
    this.#logger.warn({ nest: contextOf(params) }, 'nest warning');
  }

  error(message: unknown, ...params: unknown[]): void {
    const err = message instanceof Error ? message : undefined;
    this.#logger.error({ nest: contextOf(params), ...(err ? { err } : {}) }, 'nest error');
  }

  debug(message: unknown, ...params: unknown[]): void {
    this.log(message, ...params);
  }

  verbose(message: unknown, ...params: unknown[]): void {
    this.log(message, ...params);
  }
}
