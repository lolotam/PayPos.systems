import type { Provider } from '@nestjs/common';
import type { IdGenerator, TenantWrappers } from '@pospay/db';
import { serviceSessionErrors } from '@pospay/i18n';
import { systemClock } from '../../shared/adapters/system-clock.ts';
import { SelectedCompanyGuard } from '../../shared/selected-company.guard.ts';
import { ServiceSessionsController } from './http/service-sessions.controller.ts';
import { SessionAdminGuard, SessionAppendGuard } from './http/session-access.guard.ts';
import { SessionErrorsFilter } from './http/session-errors.filter.ts';
import { catalogReader } from './persistence/catalog-reader.adapter.ts';
import { customerLookup } from './persistence/customer-lookup.adapter.ts';
import { performerCheck } from './persistence/performer-check.adapter.ts';
import { discountLimit } from './persistence/discount-limit.adapter.ts';
import { sessionPlace } from './persistence/session-place.adapter.ts';
import { sessionRecordAccess } from './persistence/session-record-access.adapter.ts';
import { sessionReadAccess } from './persistence/session-read-access.adapter.ts';
import { BranchDayServiceSessionsQuery } from './queries/branch-day-service-sessions.query.ts';
import { createServiceSessionTransactions } from './persistence/service-session-transactions.ts';
import { RecordServiceSessionUseCase } from './use-cases/record-service-session/record-service-session.usecase.ts';
import { AppendServiceSessionLinesUseCase } from './use-cases/append-service-session-lines/append-service-session-lines.usecase.ts';
import type { Clock } from './ports/service-session-transactions.port.ts';

export const ordersControllers = [ServiceSessionsController];
export function ordersDayQuery(database: TenantWrappers) {
  return new BranchDayServiceSessionsQuery(database, {
    place: async (tx, scope) => await sessionPlace(tx, scope.companyId, scope.businessId, scope.branchId).read() !== null,
    read: (tx, scope) => sessionReadAccess(tx, scope.companyId, scope.userId, scope.businessId, scope.branchId),
  });
}
export function ordersTransactions(database: TenantWrappers, ids: IdGenerator) {
  return createServiceSessionTransactions(database, ids, (tx, context) => ({
    catalog: catalogReader(tx, context.companyId, context.businessId), customer: customerLookup(tx, context.companyId),
    performers: performerCheck(tx, context.companyId, context.businessId, context.branchId), discount: discountLimit(tx, context.companyId, context.businessId),
    place: sessionPlace(tx, context.companyId, context.businessId, context.branchId),
    access: sessionRecordAccess(tx, context.companyId, context.userId, context.businessId, context.branchId),
    discountMessages: serviceSessionErrors.SESSION_DISCOUNT_ABOVE_LIMIT,
  }));
}
export function ordersProviders(database: TenantWrappers | undefined, ids: IdGenerator, clock: Clock = systemClock): Provider[] {
  const transactions = database === undefined ? null : ordersTransactions(database, ids);
  return [SelectedCompanyGuard, SessionAdminGuard, SessionAppendGuard, SessionErrorsFilter,
    { provide: BranchDayServiceSessionsQuery, useValue: database === undefined ? null : ordersDayQuery(database) },
    { provide: RecordServiceSessionUseCase, useValue: transactions === null ? null : new RecordServiceSessionUseCase(transactions, ids, clock) },
    { provide: AppendServiceSessionLinesUseCase, useValue: transactions === null ? null : new AppendServiceSessionLinesUseCase(transactions, ids, clock) }];
}
