import type { Provider } from '@nestjs/common';
import type { IdGenerator, TenantWrappers } from '@pospay/db';
import { serviceSessionErrors } from '@pospay/i18n';
import { systemClock } from '../../shared/adapters/system-clock.ts';
import { SelectedCompanyGuard } from '../../shared/selected-company.guard.ts';
import { ServiceSessionsController } from './http/service-sessions.controller.ts';
import { ServiceSessionFormController } from './http/service-session-form.controller.ts';
import { RecordingContextQueryHandler } from './queries/recording-context.query.ts';
import { SessionServiceOptionsQueryHandler } from './queries/session-service-options.query.ts';
import { sessionServiceOptions } from './persistence/session-service-options.adapter.ts';
import { SessionPerformerOptionsQueryHandler } from './queries/session-performer-options.query.ts';
import { sessionPerformerOptions } from './persistence/session-performer-options.adapter.ts';
import { recordingAccess, recordingLimit } from './persistence/recording-context.adapter.ts';
import { SessionAdminGuard, SessionAppendGuard } from './http/session-access.guard.ts';
import { SessionErrorsFilter } from './http/session-errors.filter.ts';
import { catalogReader } from './persistence/catalog-reader.adapter.ts';
import { customerLookup } from './persistence/customer-lookup.adapter.ts';
import { performerCheck } from './persistence/performer-check.adapter.ts';
import { discountLimit } from './persistence/discount-limit.adapter.ts';
import { sessionBranchBelongs, sessionPlace } from './persistence/session-place.adapter.ts';
import { sessionRecordAccess } from './persistence/session-record-access.adapter.ts';
import { sessionReadAccess } from './persistence/session-read-access.adapter.ts';
import { BranchDayServiceSessionsQuery } from './queries/branch-day-service-sessions.query.ts';
import { createServiceSessionTransactions } from './persistence/service-session-transactions.ts';
import { RecordServiceSessionUseCase } from './use-cases/record-service-session/record-service-session.usecase.ts';
import { AppendServiceSessionLinesUseCase } from './use-cases/append-service-session-lines/append-service-session-lines.usecase.ts';
import type { Clock } from './ports/service-session-transactions.port.ts';

export const ordersControllers = [ServiceSessionsController, ServiceSessionFormController];
export function ordersPerformerOptionsQuery(database: TenantWrappers, clock: Clock = systemClock) {
  return new SessionPerformerOptionsQueryHandler(database, {
    place: (tx, scope) => sessionPlace(tx, scope.companyId, scope.businessId, scope.branchId).read(),
    access: (tx, scope, at) => recordingAccess(tx, scope.companyId, scope.userId, scope.businessId, scope.branchId, at),
    options: (tx, scope, query) => sessionPerformerOptions(tx, scope.companyId, scope.businessId, scope.branchId, query),
  }, clock);
}
export function ordersServiceOptionsQuery(database: TenantWrappers, clock: Clock = systemClock) {
  return new SessionServiceOptionsQueryHandler(database, {
    place: (tx, scope) => sessionPlace(tx, scope.companyId, scope.businessId, scope.branchId).read(),
    access: (tx, scope, at) => recordingAccess(tx, scope.companyId, scope.userId, scope.businessId, scope.branchId, at),
    options: (tx, scope, query) => sessionServiceOptions(tx, scope.companyId, scope.businessId, query),
  }, clock);
}
export function ordersRecordingContextQuery(database: TenantWrappers, clock: Clock = systemClock) {
  return new RecordingContextQueryHandler(database, {
    place: (tx, scope) => sessionPlace(tx, scope.companyId, scope.businessId, scope.branchId).read(),
    access: (tx, scope, at) => recordingAccess(tx, scope.companyId, scope.userId, scope.businessId, scope.branchId, at),
    limit: (tx, scope, membershipId) => recordingLimit(tx, scope.companyId, scope.businessId, membershipId),
  }, clock);
}
export function ordersDayQuery(database: TenantWrappers) {
  return new BranchDayServiceSessionsQuery(database, {
    place: (tx, scope) => sessionBranchBelongs(tx, scope.companyId, scope.businessId, scope.branchId),
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
    { provide: SessionPerformerOptionsQueryHandler, useValue: database === undefined ? null : ordersPerformerOptionsQuery(database, clock) },
    { provide: SessionServiceOptionsQueryHandler, useValue: database === undefined ? null : ordersServiceOptionsQuery(database, clock) },
    { provide: RecordingContextQueryHandler, useValue: database === undefined ? null : ordersRecordingContextQuery(database, clock) },
    { provide: BranchDayServiceSessionsQuery, useValue: database === undefined ? null : ordersDayQuery(database) },
    { provide: RecordServiceSessionUseCase, useValue: transactions === null ? null : new RecordServiceSessionUseCase(transactions, ids, clock) },
    { provide: AppendServiceSessionLinesUseCase, useValue: transactions === null ? null : new AppendServiceSessionLinesUseCase(transactions, ids, clock) }];
}
