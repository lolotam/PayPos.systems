import 'reflect-metadata';

import {
  Inject,
  Injectable,
  Module,
  type DynamicModule,
  type OnApplicationShutdown,
  type Type,
} from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { AuthService } from '@pospay/auth';
import type { IdGenerator, TenantWrappers } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger, type Logger } from '@pospay/observability';
import { LogController, type FastifyReply, type FastifyRequest } from 'fastify';

import {
  COMPANY_HEADER,
  assertEveryRouteGuarded,
  identityControllers,
  identityProviders,
} from './modules/identity/index.ts';
import { tenancyControllers, tenancyProviders } from './modules/tenancy/index.ts';
import { mountAuthRoutes } from './shared/auth-routes.ts';
import { DATABASE } from './shared/database.token.ts';
import { ApiError, codeForStatus } from './shared/errors.ts';
import { EnvelopeExceptionFilter } from './shared/exception.filter.ts';
import { HealthController } from './shared/health.controller.ts';
import { API_LOG_EVENTS } from './shared/log-events.ts';
import { PinoNestLogger } from './shared/nest-logger.ts';
import { READINESS_CHECKS, singleFlight, type ReadinessCheck } from './shared/readiness.ts';
import { AUTH_SERVICE, SessionGuard } from './shared/session.guard.ts';

export interface AppDependencies {
  readonly readiness: readonly ReadinessCheck[];
  /** Releases what main.ts opened (pools, clients). Runs on app.close() and on SIGTERM/SIGINT. */
  readonly onShutdown?: () => Promise<void>;
  /** Better Auth, and the public URL its routes resolve against. Without it no route but @Public() answers. */
  readonly auth?: { readonly service: AuthService; readonly baseURL: string };
  /** The tenant wrappers the access guard reads memberships through. Without them no @Require route answers. */
  readonly database?: TenantWrappers;
  /** UUID v7 for rows the use cases create; the system clock and Web Crypto unless a test injects its own. */
  readonly ids?: IdGenerator;
  /** Browser origins allowed to call the API with credentials (admin, POS). Empty: no CORS headers at all. */
  readonly corsOrigins?: readonly string[];
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
      controllers: [...controllers],
      providers: [
        { provide: READINESS_CHECKS, useValue: deps.readiness.map(singleFlight) },
        { provide: SHUTDOWN, useValue: deps.onShutdown ?? (async () => undefined) },
        ShutdownHook,
        { provide: AUTH_SERVICE, useValue: deps.auth?.service ?? null },
        // Global guards run in this order (ADR-0003 §4): a verified session unless @Public(); then the company
        // membership and the permission at the target unless @Authenticated(); then the feature flag.
        { provide: APP_GUARD, useClass: SessionGuard },
        ...identityProviders(deps.database, deps.ids ?? systemUuidV7()),
        { provide: DATABASE, useValue: deps.database ?? null },
        ...tenancyProviders(deps.database, deps.ids ?? systemUuidV7()),
      ],
    };
  }
}

// An exact allow-list with credentials — never a reflected or wildcard origin. Empty: no CORS headers at all.
function enableCors(app: NestFastifyApplication, corsOrigins: readonly string[]): void {
  if (corsOrigins.length === 0) return;
  app.enableCors({
    origin: [...corsOrigins],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['content-type', 'idempotency-key', COMPANY_HEADER],
    maxAge: 600,
  });
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
  const controllers = [
    HealthController,
    ...identityControllers,
    ...tenancyControllers,
    ...(options.controllers ?? []),
  ];
  assertEveryRouteGuarded(controllers);
  const adapter = new FastifyAdapter({
    loggerInstance: logger,
    bodyLimit: 1_048_576,
    // Fastify's own request log serialises the raw URL; we log one safe line per request instead (below).
    // Its per-request error lines go too — the envelope filter logs unhandled errors through the sanitiser.
    logController: new LogController({ disableRequestLogging: true }),
    // A malformed URL (e.g. `/%ZZ`) is rejected by Fastify's router before Nest runs; answer with the
    // envelope instead of Fastify's default body, which echoes the malformed input.
    frameworkErrors: (error: unknown, request: FastifyRequest, reply: FastifyReply) => {
      const status = (error as { statusCode?: unknown }).statusCode;
      // A catalogued Fastify status keeps its code (413, 414, 415…); another 4xx is BAD_REQUEST; a
      // server-side failure stays a 500. A missing status (a malformed URL) is a bad request.
      const apiError = new ApiError(
        typeof status === 'number' ? codeForStatus(status) : 'BAD_REQUEST',
      );
      // Fastify's own error logging is off, so a framework-side failure is logged here (type/code only).
      if (apiError.code === 'INTERNAL_ERROR') request.log.error({ err: error }, 'unhandled error');
      void reply.code(apiError.status).send(apiError.toEnvelope());
    },
  });
  // One line per request with safe, structural fields only: the route PATTERN, never the raw URL, whose
  // path segments and query string can carry tokens or phone numbers.
  if (deps.auth !== undefined) {
    mountAuthRoutes(adapter.getInstance(), deps.auth.service, {
      baseURL: deps.auth.baseURL,
      logger,
    });
  }
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
    AppModule.forRoot(deps, controllers),
    adapter,
    // abortOnError: false — an initialisation error is thrown to the caller (main.ts releases resources
    // and exits) instead of Nest exiting the process itself.
    { logger: new PinoNestLogger(logger), abortOnError: false },
  );
  enableCors(app, deps.corsOrigins ?? []);
  app.setGlobalPrefix('v1', { exclude: ['health', 'ready'] });
  app.useGlobalFilters(new EnvelopeExceptionFilter());
  await app.init();
  return app;
}
