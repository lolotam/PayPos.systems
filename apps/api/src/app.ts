import 'reflect-metadata';

import {
  Inject,
  Injectable,
  Module,
  type DynamicModule,
  type OnApplicationShutdown,
  type Type,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { createLogger, type Logger } from '@pospay/observability';
import { LogController, type FastifyReply } from 'fastify';

import { ApiError, codeForStatus } from './shared/errors.ts';
import { EnvelopeExceptionFilter } from './shared/exception.filter.ts';
import { HealthController } from './shared/health.controller.ts';
import { API_LOG_EVENTS } from './shared/log-events.ts';
import { PinoNestLogger } from './shared/nest-logger.ts';
import { READINESS_CHECKS, singleFlight, type ReadinessCheck } from './shared/readiness.ts';

export interface AppDependencies {
  readonly readiness: readonly ReadinessCheck[];
  /** Releases what main.ts opened (pools, clients). Runs on app.close() and on SIGTERM/SIGINT. */
  readonly onShutdown?: () => Promise<void>;
}

export interface AppOptions {
  /** The shared sanitising logger — main.ts builds it from the validated LOG_LEVEL; tests pass a sink. */
  readonly logger?: Logger;
  /** Test-only: extra controllers mounted beside the real ones. */
  readonly controllers?: readonly Type<unknown>[];
}

const SHUTDOWN = Symbol('SHUTDOWN');
const SHUTDOWN_TIMEOUT_MS = 10_000;

// A lifecycle provider, so cleanup runs through Nest's own shutdown path — the one SIGTERM triggers —
// and not through an override of app.close() that a signal would skip.
@Injectable()
class ShutdownHook implements OnApplicationShutdown {
  readonly #release: () => Promise<void>;

  constructor(@Inject(SHUTDOWN) release: () => Promise<void>) {
    this.#release = release;
  }

  async onApplicationShutdown(): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const limit = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, SHUTDOWN_TIMEOUT_MS);
    });
    await Promise.race([this.#release().catch(() => undefined), limit]);
    clearTimeout(timer);
  }
}

@Module({})
class AppModule {
  static forRoot(deps: AppDependencies, controllers: readonly Type<unknown>[]): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController, ...controllers],
      providers: [
        { provide: READINESS_CHECKS, useValue: deps.readiness.map(singleFlight) },
        { provide: SHUTDOWN, useValue: deps.onShutdown ?? (async () => undefined) },
        ShutdownHook,
      ],
    };
  }
}

/**
 * Builds the API: NestJS on Fastify, the shared sanitising logger, the error envelope for every error —
 * including the ones Fastify raises before Nest sees the request — `/health` and `/ready` at the root and
 * everything else under `/v1`.
 *
 * @param deps    what the app needs (readiness checks, shutdown); ports arrive with later slices
 * @param options log level, plus test hooks that are never set in production
 * @returns an initialised application, not yet listening
 */
export async function createApp(
  deps: AppDependencies,
  options: AppOptions = {},
): Promise<NestFastifyApplication> {
  const logger = options.logger ?? createLogger('info', { events: API_LOG_EVENTS });
  const adapter = new FastifyAdapter({
    loggerInstance: logger,
    bodyLimit: 1_048_576,
    // Fastify's own request log serialises the raw URL; we log one safe line per request instead (below).
    // Its per-request error lines go too — the envelope filter logs unhandled errors through the sanitiser.
    logController: new LogController({ disableRequestLogging: true }),
    // A malformed URL (e.g. `/%ZZ`) is rejected by Fastify's router before Nest runs; answer with the
    // envelope instead of Fastify's default body, which echoes the malformed input.
    frameworkErrors: (error: unknown, _request: unknown, reply: FastifyReply) => {
      const status = (error as { statusCode?: unknown }).statusCode;
      // A catalogued Fastify status keeps its code (413, 414, 415…); another 4xx is BAD_REQUEST; a
      // server-side failure stays a 500. A missing status (a malformed URL) is a bad request.
      const apiError = new ApiError(
        typeof status === 'number' ? codeForStatus(status) : 'BAD_REQUEST',
      );
      void reply.code(apiError.status).send(apiError.toEnvelope());
    },
  });
  // One line per request with safe, structural fields only: the route PATTERN, never the raw URL, whose
  // path segments and query string can carry tokens or phone numbers.
  adapter.getInstance().addHook('onResponse', async (request, reply) => {
    request.log.info(
      {
        http: {
          method: request.method,
          route: request.routeOptions.url ?? '[unmatched]',
          status: reply.statusCode,
          ms: Math.round(reply.elapsedTime),
        },
      },
      'request completed',
    );
  });
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRoot(deps, options.controllers ?? []),
    adapter,
    // abortOnError: false — an initialisation error is thrown to the caller (main.ts releases resources
    // and exits) instead of Nest exiting the process itself.
    { logger: new PinoNestLogger(logger), abortOnError: false },
  );
  app.setGlobalPrefix('v1', { exclude: ['health', 'ready'] });
  app.useGlobalFilters(new EnvelopeExceptionFilter());
  await app.init();
  return app;
}
