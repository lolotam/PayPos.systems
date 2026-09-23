import 'reflect-metadata';

import {
  Inject,
  Injectable,
  Module,
  type DynamicModule,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Logger } from '@pospay/observability';
import { LogController } from 'fastify';

import {
  HealthController,
  READINESS_CHECKS,
  type ReadinessCheck,
} from './shared/health.controller.ts';

export interface WorkerDependencies {
  readonly readiness: readonly ReadinessCheck[];
  /** Stops the dispatch loop and waits for its batch in flight. Runs first on shutdown. */
  readonly stopPolling: () => Promise<void>;
  /** Closes the pools and the Redis connection. Runs after polling has stopped. */
  readonly release: () => Promise<void>;
}

type Shutdown = Pick<WorkerDependencies, 'stopPolling' | 'release'>;

const SHUTDOWN = Symbol('SHUTDOWN');
const SHUTDOWN_TIMEOUT_MS = 10_000;

// Through Nest's shutdown path, the one SIGTERM triggers. The order is the point: no batch may still be
// running when its database pool closes.
@Injectable()
class ShutdownHook implements OnApplicationShutdown {
  readonly #deps: Shutdown;

  constructor(@Inject(SHUTDOWN) deps: Shutdown) {
    this.#deps = deps;
  }

  async onApplicationShutdown(): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const limit = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, SHUTDOWN_TIMEOUT_MS);
    });
    const ordered = async (): Promise<void> => {
      await this.#deps.stopPolling().catch(() => undefined);
      await this.#deps.release().catch(() => undefined);
    };
    await Promise.race([ordered(), limit]);
    clearTimeout(timer);
  }
}

@Module({})
class WorkerModule {
  static forRoot(deps: WorkerDependencies): DynamicModule {
    return {
      module: WorkerModule,
      controllers: [HealthController],
      providers: [
        { provide: READINESS_CHECKS, useValue: deps.readiness },
        { provide: SHUTDOWN, useValue: { stopPolling: deps.stopPolling, release: deps.release } },
        ShutdownHook,
      ],
    };
  }
}

/**
 * Builds the worker's Nest application: `/health`, `/ready` and the ordered shutdown. Nest's console
 * logger is off — a startup error is thrown to main.ts, which logs it sanitised.
 *
 * @param deps   readiness checks, how to stop polling, how to release resources
 * @param logger the shared sanitising logger
 * @returns an initialised application, not yet listening
 */
export async function createWorker(
  deps: WorkerDependencies,
  logger: Logger,
): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    loggerInstance: logger,
    logController: new LogController({ disableRequestLogging: true }),
  });
  const app = await NestFactory.create<NestFastifyApplication>(
    WorkerModule.forRoot(deps),
    adapter,
    { logger: false, abortOnError: false },
  );
  await app.init();
  return app;
}
