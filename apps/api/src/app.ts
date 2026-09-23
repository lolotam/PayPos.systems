import 'reflect-metadata';

import { Module, type DynamicModule, type Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { createLogger, type DestinationStream } from '@pospay/observability';

import { EnvelopeExceptionFilter } from './shared/exception.filter.ts';
import { HealthController } from './shared/health.controller.ts';
import { READINESS_CHECKS, type ReadinessCheck } from './shared/readiness.ts';

export interface AppDependencies {
  readonly readiness: readonly ReadinessCheck[];
}

export interface AppOptions {
  /** Test-only: extra controllers mounted beside the real ones. */
  readonly controllers?: readonly Type<unknown>[];
  /** Test-only: where log lines go, so a test can read them. */
  readonly logDestination?: DestinationStream;
}

@Module({})
class AppModule {
  static forRoot(deps: AppDependencies, controllers: readonly Type<unknown>[]): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController, ...controllers],
      providers: [{ provide: READINESS_CHECKS, useValue: deps.readiness }],
    };
  }
}

/**
 * Builds the API: NestJS on Fastify, the shared redacting logger, the error envelope for every error,
 * `/health` and `/ready` at the root and everything else under `/v1`.
 *
 * @param deps    the dependencies the app needs (readiness checks today; ports later)
 * @param options test hooks — never set in production
 * @returns an initialised application, not yet listening
 */
export async function createApp(
  deps: AppDependencies,
  options: AppOptions = {},
): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    loggerInstance: createLogger(options.logDestination),
    bodyLimit: 1_048_576,
  });
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRoot(deps, options.controllers ?? []),
    adapter,
    { logger: ['error', 'warn'] },
  );
  app.setGlobalPrefix('v1', { exclude: ['health', 'ready'] });
  app.useGlobalFilters(new EnvelopeExceptionFilter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
