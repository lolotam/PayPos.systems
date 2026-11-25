import type { Provider } from '@nestjs/common';
import type { IdGenerator, TenantWrappers } from '@pospay/db';
import type { Redis } from 'ioredis';

import { createRedisRateLimiter } from '../../shared/adapters/redis-rate-limiter.ts';
import { systemClock } from '../../shared/adapters/system-clock.ts';
import type { Clock } from '../../shared/ports/clock.port.ts';
import {
  createStatementExportTransactions,
  type StatementExportReaders,
} from './persistence/statement-export-transactions.ts';
import type {
  StatementExportDocumentStore,
  StatementExportTransport,
} from './ports/statement-export.port.ts';
import {
  createStatementExportStatusQuery,
  STATEMENT_EXPORT_STATUS_QUERY,
  type StatementExportStatusRead,
} from './queries/statement-export-status.query.ts';
import { CollectStatementExportUseCase } from './use-cases/collect-statement-export/collect-statement-export.usecase.ts';
import { RequestStatementExportUseCase } from './use-cases/request-statement-export/request-statement-export.usecase.ts';

/**
 * ما بيجي من وحدات تانية ومربوط في جذر التطبيق: قراءات الصلاحية والعضوية، ومصانع نقل المستند على Redis
 * (الطابور والبايتات والحالة، من ADR-0049). الوحدة ما بتستوردش حد منهم.
 */
export interface StatementExportBindings {
  readonly readers: StatementExportReaders;
  readonly documents: {
    readonly transport: (redis: Redis) => StatementExportTransport;
    readonly store: (redis: Redis) => StatementExportDocumentStore;
    readonly status: (redis: Redis) => StatementExportStatusRead;
  };
}

const STATEMENT_EXPORT_TRANSPORT = Symbol('STATEMENT_EXPORT_TRANSPORT');

/**
 * مزودو تصدير كشف العمولات (56-1c): الطلب والتحميل والحالة. من غير داتابيز أو Redis بترجع null،
 * والـ controller بيرد NOT_READY زي بقية مسارات المستندات.
 *
 * @param database واجهات الداتابيز
 * @param redis اتصال Redis للطابور والبايتات والحد
 * @param ids مولّد المعرّفات
 * @param bindings المربوط في الجذر
 * @param clock ساعة الطلب والتحميل
 * @returns مزودو Nest
 */
export function commissionStatementExportProviders(
  database: TenantWrappers | undefined,
  redis: Redis | undefined,
  ids: IdGenerator,
  bindings: StatementExportBindings,
  clock: Clock = systemClock,
): Provider[] {
  if (database === undefined || redis === undefined) return unavailableProviders();
  const transactions = createStatementExportTransactions(database, ids, bindings.readers);
  const transport = bindings.documents.transport(redis);
  return [
    { provide: STATEMENT_EXPORT_TRANSPORT, useValue: transport },
    {
      provide: RequestStatementExportUseCase,
      useValue: new RequestStatementExportUseCase(
        transactions,
        transport,
        createRedisRateLimiter(redis),
        clock,
        ids,
      ),
    },
    {
      provide: CollectStatementExportUseCase,
      useValue: new CollectStatementExportUseCase(
        transactions,
        bindings.documents.store(redis),
        clock,
      ),
    },
    {
      provide: STATEMENT_EXPORT_STATUS_QUERY,
      useValue: createStatementExportStatusQuery(
        database,
        bindings.documents.status(redis),
        bindings.readers,
      ),
    },
  ];
}

function unavailableProviders(): Provider[] {
  return [
    STATEMENT_EXPORT_TRANSPORT,
    RequestStatementExportUseCase,
    CollectStatementExportUseCase,
    STATEMENT_EXPORT_STATUS_QUERY,
  ].map((provide) => ({ provide, useValue: null }));
}
