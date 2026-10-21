import type { Provider } from '@nestjs/common';
import type { IdGenerator, TenantWrappers } from '@pospay/db';
import { serviceSessionErrors } from '@pospay/i18n';
import { systemClock } from '../../shared/adapters/system-clock.ts';
import { SelectedCompanyGuard } from '../../shared/selected-company.guard.ts';
import { ServiceSessionsController } from './http/service-sessions.controller.ts';
import { SessionTipsController } from './http/session-tips.controller.ts';
import { ServiceSessionFormController } from './http/service-session-form.controller.ts';
import { RecordingContextQueryHandler } from './queries/recording-context.query.ts';
import { SessionServiceOptionsQueryHandler } from './queries/session-service-options.query.ts';
import { sessionServiceOptions } from './persistence/session-service-options.adapter.ts';
import { SessionPerformerOptionsQueryHandler } from './queries/session-performer-options.query.ts';
import { sessionTime } from './domain/session-time.ts';
import { sessionPerformerOptions } from './persistence/session-performer-options.adapter.ts';
import { pickerAccess, recordingAccess, recordingLimit } from './persistence/recording-context.adapter.ts';
import { SessionAdminGuard, SessionAppendGuard } from './http/session-access.guard.ts';
import { SessionErrorsFilter } from './http/session-errors.filter.ts';
import { catalogReader } from './persistence/catalog-reader.adapter.ts';
import { customerLookup } from './persistence/customer-lookup.adapter.ts';
import { performerCheck } from './persistence/performer-check.adapter.ts';
import { discountLimit } from './persistence/discount-limit.adapter.ts';
import { sessionBranchBelongs, sessionPlace } from './persistence/session-place.adapter.ts';
import { sessionRecordAccess } from './persistence/session-record-access.adapter.ts';
import { sessionCancelCapability, sessionPerformersCapability } from './persistence/session-edit-access.adapter.ts';
import { sessionReadAccess } from './persistence/session-read-access.adapter.ts';
import { BranchDayServiceSessionsQuery } from './queries/branch-day-service-sessions.query.ts';
import { ServiceSessionCapabilitiesQuery } from './queries/service-session-capabilities.query.ts';
import { ServiceLineCancellationQuery } from './queries/service-line-cancellation.query.ts';
import { ServiceLineEditHistoryQuery } from './queries/service-line-edits.query.ts';
import { ServiceLinePerformerChangeHistoryQuery } from './queries/service-line-performer-changes.query.ts';
import { SessionTipsCurrentQuery } from './queries/session-tips-current.query.ts';
import { createServiceSessionTransactions } from './persistence/service-session-transactions.ts';
import { bindLineEditReaders, createLineEditTransactions } from './persistence/line-edit-transactions.ts';
import { bindLineCancelReaders, createLineCancelTransactions } from './persistence/line-cancel-transactions.ts';
import { bindLinePerformersReaders, createLinePerformersTransactions } from './persistence/line-performers-transactions.ts';
import { createSessionTipsTransactions } from './persistence/session-tip-transactions.ts';
import { createSessionRecovery, recoveryKeyHash } from './persistence/session-recovery.adapter.ts';
import { sessionRecoveryPlace, sessionRecoveryRecord } from './persistence/session-recovery-read.adapter.ts';
import { createSessionRecoveryConfirm } from './persistence/session-recovery-confirm.adapter.ts';
import { SessionRecoveryQuery } from './queries/session-recovery.query.ts';
import { RecordServiceSessionUseCase } from './use-cases/record-service-session/record-service-session.usecase.ts';
import { AppendServiceSessionLinesUseCase } from './use-cases/append-service-session-lines/append-service-session-lines.usecase.ts';
import { EditServiceLinePriceUseCase } from './use-cases/edit-service-line-price/edit-service-line-price.usecase.ts';
import { CancelServiceLineUseCase } from './use-cases/cancel-service-line/cancel-service-line.usecase.ts';
import { ChangeLinePerformersUseCase } from './use-cases/change-line-performers/change-line-performers.usecase.ts';
import { RecordSessionTipsUseCase } from './use-cases/record-session-tips/record-session-tips.usecase.ts';
import { ConfirmSessionRecoveryUseCase } from './use-cases/confirm-session-recovery/confirm-session-recovery.usecase.ts';
import { SessionRecoveryController } from './http/session-recovery.controller.ts';
import type { Clock } from './ports/service-session-transactions.port.ts';

export const ordersControllers = [SessionRecoveryController, ServiceSessionsController, ServiceSessionFormController, SessionTipsController];
export function ordersPerformerOptionsQuery(database: TenantWrappers, clock: Clock = systemClock) {
  return new SessionPerformerOptionsQueryHandler(database, {
    time: (occurredAt, at, timezone) => sessionTime(new Date(occurredAt), at, timezone).occurred_at.toISOString(),
    place: (tx, scope) => sessionPlace(tx, scope.companyId, scope.businessId, scope.branchId).read(),
    access: (tx, scope, at) => pickerAccess(tx, scope.companyId, scope.userId, scope.businessId, scope.branchId, at),
    options: (tx, scope, query, normalizeTime) => sessionPerformerOptions(tx, scope.companyId, scope.businessId, scope.branchId, query, normalizeTime),
  }, clock);
}
export function ordersServiceOptionsQuery(database: TenantWrappers, clock: Clock = systemClock) {
  return new SessionServiceOptionsQueryHandler(database, {
    place: (tx, scope) => sessionPlace(tx, scope.companyId, scope.businessId, scope.branchId).read(),
    access: (tx, scope, at) => recordingAccess(tx, scope.companyId, scope.userId, scope.businessId, scope.branchId, at),
    options: (tx, scope, query) => sessionServiceOptions(tx, scope.companyId, scope.businessId, scope.branchId, query),
  }, clock);
}
export function ordersRecordingContextQuery(database: TenantWrappers, clock: Clock = systemClock) {
  return new RecordingContextQueryHandler(database, {
    place: (tx, scope) => sessionPlace(tx, scope.companyId, scope.businessId, scope.branchId).read(),
    access: (tx, scope, at) => pickerAccess(tx, scope.companyId, scope.userId, scope.businessId, scope.branchId, at),
    limit: (tx, scope, membershipId) => recordingLimit(tx, scope.companyId, scope.businessId, membershipId),
  }, clock);
}
export function ordersRecoveryQuery(database: TenantWrappers, clock: Clock = systemClock) {
  return new SessionRecoveryQuery(database, {
    place: (tx, scope) => sessionRecoveryPlace(tx, scope.companyId, scope.businessId, scope.branchId),
    record: (tx, scope, at) => sessionRecoveryRecord(tx, scope.companyId, scope.userId, scope.businessId, scope.branchId, at),
  }, clock, recoveryKeyHash);
}
export function ordersRecoveryConfirm(database: TenantWrappers, ids: IdGenerator, clock: Clock = systemClock) {
  return new ConfirmSessionRecoveryUseCase(createSessionRecoveryConfirm(database), ids, clock);
}
export function ordersDayQuery(database: TenantWrappers) {
  return new BranchDayServiceSessionsQuery(database, {
    place: (tx, scope) => sessionBranchBelongs(tx, scope.companyId, scope.businessId, scope.branchId),
    read: (tx, scope) => sessionReadAccess(tx, scope.companyId, scope.userId, scope.businessId, scope.branchId),
  });
}
export function ordersLineEditHistory(database: TenantWrappers) {
  return new ServiceLineEditHistoryQuery(database, {
    place: (tx, scope) => sessionBranchBelongs(tx, scope.companyId, scope.businessId, scope.branchId),
    read: (tx, scope) => sessionReadAccess(tx, scope.companyId, scope.userId, scope.businessId, scope.branchId),
  });
}
export function ordersLinePerformerChangeHistory(database: TenantWrappers) {
  return new ServiceLinePerformerChangeHistoryQuery(database, {
    place: (tx, scope) => sessionBranchBelongs(tx, scope.companyId, scope.businessId, scope.branchId),
    read: (tx, scope) => sessionReadAccess(tx, scope.companyId, scope.userId, scope.businessId, scope.branchId),
  });
}
export function ordersLineCancellation(database: TenantWrappers) {
  return new ServiceLineCancellationQuery(database, {
    place: (tx, scope) => sessionBranchBelongs(tx, scope.companyId, scope.businessId, scope.branchId),
    read: (tx, scope) => sessionReadAccess(tx, scope.companyId, scope.userId, scope.businessId, scope.branchId),
  });
}
export function ordersCapabilitiesQuery(database: TenantWrappers) {
  return new ServiceSessionCapabilitiesQuery(database, {
    place: (tx, scope) => sessionBranchBelongs(tx, scope.companyId, scope.businessId, scope.branchId),
    read: (tx, scope) => sessionReadAccess(tx, scope.companyId, scope.userId, scope.businessId, scope.branchId),
    cancel: (tx, scope, at) => sessionCancelCapability(tx, scope.companyId, scope.userId, scope.businessId, scope.branchId, at),
    performers: (tx, scope, at) => sessionPerformersCapability(tx, scope.companyId, scope.userId, scope.businessId, scope.branchId, at),
  });
}
export function ordersLineEdits(database: TenantWrappers) {
  return createLineEditTransactions(database, bindLineEditReaders);
}
export function ordersLineCancels(database: TenantWrappers) {
  return createLineCancelTransactions(database, bindLineCancelReaders);
}
export function ordersLinePerformers(database: TenantWrappers) {
  return createLinePerformersTransactions(database, bindLinePerformersReaders);
}
export function ordersSessionTips(database: TenantWrappers) {
  return createSessionTipsTransactions(database);
}
export function ordersSessionTipsCurrent(database: TenantWrappers, clock: Clock = systemClock) {
  return new SessionTipsCurrentQuery(database, {
    access: (tx, scope, at) => sessionRecordAccess(tx, scope.companyId, scope.userId, scope.businessId, scope.branchId).read(at),
  }, clock);
}
export function ordersTransactions(database: TenantWrappers, ids: IdGenerator, clock: Clock = systemClock) {
  return createServiceSessionTransactions(database, ids, (tx, context) => ({
    catalog: catalogReader(tx, context.companyId, context.businessId), customer: customerLookup(tx, context.companyId),
    performers: performerCheck(tx, context.companyId, context.businessId, context.branchId), discount: discountLimit(tx, context.companyId, context.businessId),
    place: sessionPlace(tx, context.companyId, context.businessId, context.branchId),
    access: sessionRecordAccess(tx, context.companyId, context.userId, context.businessId, context.branchId),
    discountMessages: serviceSessionErrors.SESSION_DISCOUNT_ABOVE_LIMIT,
  }), clock);
}
export function ordersProviders(database: TenantWrappers | undefined, ids: IdGenerator, clock: Clock = systemClock): Provider[] {
  const writes = database === undefined ? null : {
    transactions: ordersTransactions(database, ids, clock), recovery: createSessionRecovery(database, ids, clock),
  };
  return [SelectedCompanyGuard, SessionAdminGuard, SessionAppendGuard, { provide: SessionErrorsFilter, useValue: new SessionErrorsFilter() },
    { provide: SessionPerformerOptionsQueryHandler, useValue: database === undefined ? null : ordersPerformerOptionsQuery(database, clock) },
    { provide: SessionServiceOptionsQueryHandler, useValue: database === undefined ? null : ordersServiceOptionsQuery(database, clock) },
    { provide: RecordingContextQueryHandler, useValue: database === undefined ? null : ordersRecordingContextQuery(database, clock) },
    { provide: BranchDayServiceSessionsQuery, useValue: database === undefined ? null : ordersDayQuery(database) },
    { provide: ServiceLineEditHistoryQuery, useValue: database === undefined ? null : ordersLineEditHistory(database) },
    { provide: ServiceLinePerformerChangeHistoryQuery, useValue: database === undefined ? null : ordersLinePerformerChangeHistory(database) },
    { provide: ServiceLineCancellationQuery, useValue: database === undefined ? null : ordersLineCancellation(database) },
    { provide: ServiceSessionCapabilitiesQuery, useValue: database === undefined ? null : ordersCapabilitiesQuery(database) },
    { provide: SessionRecoveryQuery, useValue: database === undefined ? null : ordersRecoveryQuery(database, clock) },
    { provide: ConfirmSessionRecoveryUseCase, useValue: database === undefined ? null : ordersRecoveryConfirm(database, ids, clock) },
    { provide: RecordServiceSessionUseCase, useValue: writes === null ? null : new RecordServiceSessionUseCase(writes.transactions, writes.recovery, ids, clock) },
    { provide: AppendServiceSessionLinesUseCase, useValue: writes === null ? null : new AppendServiceSessionLinesUseCase(writes.transactions, writes.recovery, ids, clock) },
    { provide: EditServiceLinePriceUseCase, useValue: database === undefined ? null : new EditServiceLinePriceUseCase(ordersLineEdits(database), ids, clock) },
    { provide: CancelServiceLineUseCase, useValue: database === undefined ? null : new CancelServiceLineUseCase(ordersLineCancels(database), ids, clock) },
    { provide: ChangeLinePerformersUseCase, useValue: database === undefined ? null : new ChangeLinePerformersUseCase(ordersLinePerformers(database), ids, clock) },
    { provide: RecordSessionTipsUseCase, useValue: database === undefined ? null : new RecordSessionTipsUseCase(ordersSessionTips(database), ids, clock) },
    { provide: SessionTipsCurrentQuery, useValue: database === undefined ? null : ordersSessionTipsCurrent(database, clock) }];
}
