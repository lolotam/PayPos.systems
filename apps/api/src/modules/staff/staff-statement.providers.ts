import type { Provider } from '@nestjs/common';
import type { IdGenerator, TenantWrappers } from '@pospay/db';
import type { Redis } from 'ioredis';

import { createRedisRateLimiter } from '../../shared/adapters/redis-rate-limiter.ts';
import { systemClock } from '../../shared/adapters/system-clock.ts';
import type { Clock } from '../../shared/ports/clock.port.ts';
import { ATTENDANCE_STATEMENT_BRANCH_READ } from './http/attendance-statements.tokens.ts';
import { readStatementBranch } from './persistence/attendance-statement-branch.ts';
import { createAttendanceStatementCollectTransactions } from './persistence/attendance-statement-collect-transactions.ts';
import { createAttendanceStatementTransactions } from './persistence/attendance-statement-transactions.ts';
import { createDocumentRenderTransport } from './persistence/bullmq-document-render-transport.ts';
import { createRedisDocumentBytesStore } from './persistence/redis-document-bytes-store.ts';
import { createDocumentStatusReader } from './persistence/redis-document-status.ts';
import type { DocumentRenderTransport } from './ports/attendance-statement.port.ts';
import { DOCUMENT_STATUS_READ } from './queries/attendance-statement-status.query.ts';
import { CollectAttendanceStatementUseCase } from './use-cases/collect-attendance-statement/collect-attendance-statement.usecase.ts';
import { RequestAttendanceStatementUseCase } from './use-cases/request-attendance-statement/request-attendance-statement.usecase.ts';

export const ATTENDANCE_STATEMENT_CLOCK = Symbol('ATTENDANCE_STATEMENT_CLOCK');
export const ATTENDANCE_STATEMENT_TRANSPORT = Symbol('ATTENDANCE_STATEMENT_TRANSPORT');

export function attendanceStatementProviders(
  database: TenantWrappers | undefined,
  redis: Redis | undefined,
  ids: IdGenerator,
): Provider[] {
  const transactions =
    database === undefined ? null : createAttendanceStatementTransactions(database);
  const transport =
    database === undefined || redis === undefined ? null : createDocumentRenderTransport(redis);
  const rateLimiter = redis === undefined ? null : createRedisRateLimiter(redis);
  const collectTransactions =
    database === undefined ? null : createAttendanceStatementCollectTransactions(database, ids);
  const bytesStore = redis === undefined ? null : createRedisDocumentBytesStore(redis);
  const statusReader = redis === undefined ? null : createDocumentStatusReader(redis);
  return [
    { provide: ATTENDANCE_STATEMENT_CLOCK, useValue: systemClock },
    { provide: ATTENDANCE_STATEMENT_TRANSPORT, useValue: transport },
    {
      provide: RequestAttendanceStatementUseCase,
      inject: [ATTENDANCE_STATEMENT_CLOCK, ATTENDANCE_STATEMENT_TRANSPORT],
      useFactory: (clock: Clock, renderTransport: DocumentRenderTransport | null) =>
        transactions === null || renderTransport === null || rateLimiter === null
          ? null
          : new RequestAttendanceStatementUseCase(
              transactions,
              renderTransport,
              rateLimiter,
              clock,
              ids,
            ),
    },
    {
      provide: CollectAttendanceStatementUseCase,
      useFactory: () =>
        collectTransactions === null || bytesStore === null
          ? null
          : new CollectAttendanceStatementUseCase(collectTransactions, bytesStore),
    },
    { provide: DOCUMENT_STATUS_READ, useValue: statusReader },
    { provide: ATTENDANCE_STATEMENT_BRANCH_READ, useValue: readStatementBranch },
  ];
}
