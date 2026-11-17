import type { Provider } from '@nestjs/common';
import type { IdGenerator, TenantWrappers } from '@pospay/db';
import { parseMoney, sumMonthlyTipTotalsByMethod } from '@pospay/domain';
import { serviceSessionErrors } from '@pospay/i18n';
import { systemClock } from '../../shared/adapters/system-clock.ts';
import { RecordingContextQueryHandler } from './queries/recording-context.query.ts';
import { SessionServiceOptionsQueryHandler } from './queries/session-service-options.query.ts';
import { sessionServiceOptions } from './persistence/session-service-options.adapter.ts';
import { SessionPerformerOptionsQueryHandler } from './queries/session-performer-options.query.ts';
import { sessionTime } from './domain/session-time.ts';
import { sessionPerformerOptions } from './persistence/session-performer-options.adapter.ts';
import {
  pickerAccess,
  recordingAccess,
  recordingLimit,
  sessionRecordCapability,
} from './persistence/recording-context.adapter.ts';
import { catalogReader } from './persistence/catalog-reader.adapter.ts';
import { customerLookup } from './persistence/customer-lookup.adapter.ts';
import { performerCheck } from './persistence/performer-check.adapter.ts';
import { discountLimit } from './persistence/discount-limit.adapter.ts';
import { editorName } from './persistence/editor-name.adapter.ts';
import { sessionBranchBelongs, sessionPlace } from './persistence/session-place.adapter.ts';
import {
  discountRequestAccess,
  sessionRecordAccess,
} from './persistence/session-record-access.adapter.ts';
import {
  sessionCancelCapability,
  sessionPerformersCapability,
} from './persistence/session-edit-access.adapter.ts';
import {
  discountApprovalListAccess,
  sessionReadAccess,
} from './persistence/session-read-access.adapter.ts';
import { BranchDayServiceSessionsQuery } from './queries/branch-day-service-sessions.query.ts';
import { ServiceSessionCapabilitiesQuery } from './queries/service-session-capabilities.query.ts';
import { ServiceLineCancellationQuery } from './queries/service-line-cancellation.query.ts';
import { ServiceLineEditHistoryQuery } from './queries/service-line-edits.query.ts';
import { ServiceLinePerformerChangeHistoryQuery } from './queries/service-line-performer-changes.query.ts';
import { SessionTipsCurrentQuery } from './queries/session-tips-current.query.ts';
import { createServiceSessionTransactions } from './persistence/service-session-transactions.ts';
import {
  bindLineEditReaders,
  createLineEditTransactions,
} from './persistence/line-edit-transactions.ts';
import {
  bindLineCancelReaders,
  createLineCancelTransactions,
} from './persistence/line-cancel-transactions.ts';
import {
  bindLinePerformersReaders,
  createLinePerformersTransactions,
} from './persistence/line-performers-transactions.ts';
import { createSessionTipsTransactions } from './persistence/session-tip-transactions.ts';
import { recoveryKeyHash } from './persistence/session-recovery.adapter.ts';
import { createDiscountRequestTransactions } from './persistence/discount-request-transactions.ts';
import { PendingDiscountProposalsQuery } from './queries/pending-discount-proposals.query.ts';
import { RequesterDiscountProposalsQuery } from './queries/requester-discount-proposals.query.ts';
import { createDiscountDecisionTransactions } from './persistence/discount-decision-transactions.ts';
import { discountApprovalAccess } from './persistence/discount-approval-access.adapter.ts';
import {
  sessionRecoveryPlace,
  sessionRecoveryRecord,
} from './persistence/session-recovery-read.adapter.ts';
import { createSessionRecoveryConfirm } from './persistence/session-recovery-confirm.adapter.ts';
import { SessionRecoveryQuery } from './queries/session-recovery.query.ts';
import { ConfirmSessionRecoveryUseCase } from './use-cases/confirm-session-recovery/confirm-session-recovery.usecase.ts';
import type { Clock } from './ports/service-session-transactions.port.ts';
import { DeviceDiscountProposalsQuery } from './queries/device-discount-proposals.query.ts';
import {
  discountDeviceBusiness,
  discountPinFence,
} from './persistence/discount-pin-fence.adapter.ts';
import { OWN_WORK_READS, type OwnWorkReads } from './queries/own-work-context.ts';
import { OWN_WORK_CLOCK } from './http/own-work.controller.ts';
import { ownWorkContext } from './persistence/own-work-context.adapter.ts';
import { ownWorkPeriodAllowed } from './domain/own-work-period.ts';
import { staffColumns } from './persistence/staff-columns.adapter.ts';

export function ordersPerformerOptionsQuery(database: TenantWrappers, clock: Clock = systemClock) {
  return new SessionPerformerOptionsQueryHandler(
    database,
    {
      time: (occurredAt, at, timezone) =>
        sessionTime(new Date(occurredAt), at, timezone).occurred_at.toISOString(),
      place: (tx, scope) =>
        sessionPlace(tx, scope.companyId, scope.businessId, scope.branchId).read(),
      access: (tx, scope, at) =>
        pickerAccess(tx, scope.companyId, scope.userId, scope.businessId, scope.branchId, at),
      options: (tx, scope, query, normalizeTime) =>
        sessionPerformerOptions(
          tx,
          scope.companyId,
          scope.businessId,
          scope.branchId,
          query,
          normalizeTime,
        ),
    },
    clock,
  );
}
export function ordersServiceOptionsQuery(database: TenantWrappers, clock: Clock = systemClock) {
  return new SessionServiceOptionsQueryHandler(
    database,
    {
      place: (tx, scope) =>
        sessionPlace(tx, scope.companyId, scope.businessId, scope.branchId).read(),
      access: (tx, scope, at) =>
        recordingAccess(tx, scope.companyId, scope.userId, scope.businessId, scope.branchId, at),
      options: (tx, scope, query) =>
        sessionServiceOptions(tx, scope.companyId, scope.businessId, scope.branchId, query),
    },
    clock,
  );
}
export function ordersRecordingContextQuery(database: TenantWrappers, clock: Clock = systemClock) {
  return new RecordingContextQueryHandler(
    database,
    {
      place: (tx, scope) =>
        sessionPlace(tx, scope.companyId, scope.businessId, scope.branchId).read(),
      access: (tx, scope, at) =>
        pickerAccess(tx, scope.companyId, scope.userId, scope.businessId, scope.branchId, at),
      limit: (tx, scope, membershipId) =>
        recordingLimit(tx, scope.companyId, scope.businessId, membershipId),
    },
    clock,
  );
}
export function ordersRecoveryQuery(database: TenantWrappers, clock: Clock = systemClock) {
  return new SessionRecoveryQuery(
    database,
    {
      place: (tx, scope) =>
        sessionRecoveryPlace(tx, scope.companyId, scope.businessId, scope.branchId),
      record: (tx, scope, at) =>
        sessionRecoveryRecord(
          tx,
          scope.companyId,
          scope.userId,
          scope.businessId,
          scope.branchId,
          at,
        ),
    },
    clock,
    recoveryKeyHash,
  );
}
export function ordersRecoveryConfirm(
  database: TenantWrappers,
  ids: IdGenerator,
  clock: Clock = systemClock,
) {
  return new ConfirmSessionRecoveryUseCase(createSessionRecoveryConfirm(database), ids, clock);
}
export function ordersDayQuery(database: TenantWrappers) {
  return new BranchDayServiceSessionsQuery(database, {
    place: (tx, scope) =>
      sessionBranchBelongs(tx, scope.companyId, scope.businessId, scope.branchId),
    read: (tx, scope) =>
      sessionReadAccess(tx, scope.companyId, scope.userId, scope.businessId, scope.branchId),
  });
}
export function ordersLineEditHistory(database: TenantWrappers) {
  return new ServiceLineEditHistoryQuery(database, {
    place: (tx, scope) =>
      sessionBranchBelongs(tx, scope.companyId, scope.businessId, scope.branchId),
    read: (tx, scope) =>
      sessionReadAccess(tx, scope.companyId, scope.userId, scope.businessId, scope.branchId),
  });
}
export function ordersLinePerformerChangeHistory(database: TenantWrappers) {
  return new ServiceLinePerformerChangeHistoryQuery(database, {
    place: (tx, scope) =>
      sessionBranchBelongs(tx, scope.companyId, scope.businessId, scope.branchId),
    read: (tx, scope) =>
      sessionReadAccess(tx, scope.companyId, scope.userId, scope.businessId, scope.branchId),
  });
}
export function ordersLineCancellation(database: TenantWrappers) {
  return new ServiceLineCancellationQuery(database, {
    place: (tx, scope) =>
      sessionBranchBelongs(tx, scope.companyId, scope.businessId, scope.branchId),
    read: (tx, scope) =>
      sessionReadAccess(tx, scope.companyId, scope.userId, scope.businessId, scope.branchId),
  });
}
export function ordersCapabilitiesQuery(database: TenantWrappers) {
  return new ServiceSessionCapabilitiesQuery(database, {
    place: (tx, scope) =>
      sessionBranchBelongs(tx, scope.companyId, scope.businessId, scope.branchId),
    read: (tx, scope) =>
      sessionReadAccess(tx, scope.companyId, scope.userId, scope.businessId, scope.branchId),
    cancel: (tx, scope, at) =>
      sessionCancelCapability(
        tx,
        scope.companyId,
        scope.userId,
        scope.businessId,
        scope.branchId,
        at,
      ),
    performers: (tx, scope, at) =>
      sessionPerformersCapability(
        tx,
        scope.companyId,
        scope.userId,
        scope.businessId,
        scope.branchId,
        at,
      ),
    record: (tx, scope, at) =>
      sessionRecordCapability(
        tx,
        scope.companyId,
        scope.userId,
        scope.businessId,
        scope.branchId,
        at,
      ),
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
  return new SessionTipsCurrentQuery(
    database,
    {
      access: (tx, scope, at) =>
        sessionRecordAccess(
          tx,
          scope.companyId,
          scope.userId,
          scope.businessId,
          scope.branchId,
        ).read(at),
    },
    clock,
  );
}
export function ordersTransactions(
  database: TenantWrappers,
  ids: IdGenerator,
  clock: Clock = systemClock,
) {
  return createServiceSessionTransactions(
    database,
    ids,
    (tx, context) => ({
      catalog: catalogReader(tx, context.companyId, context.businessId),
      customer: customerLookup(tx, context.companyId),
      performers: performerCheck(tx, context.companyId, context.businessId, context.branchId),
      discount: discountLimit(tx, context.companyId, context.businessId),
      place: sessionPlace(tx, context.companyId, context.businessId, context.branchId),
      access: sessionRecordAccess(
        tx,
        context.companyId,
        context.userId,
        context.businessId,
        context.branchId,
      ),
      discountMessages: serviceSessionErrors.SESSION_DISCOUNT_ABOVE_LIMIT,
    }),
    clock,
  );
}
export function ordersDiscountRequests(database: TenantWrappers, ids: IdGenerator) {
  return createDiscountRequestTransactions(database, ids, (tx, context) => ({
    place: sessionPlace(tx, context.companyId, context.businessId, context.branchId),
    access: discountRequestAccess(
      tx,
      context.companyId,
      context.userId,
      context.businessId,
      context.branchId,
    ),
    catalog: catalogReader(tx, context.companyId, context.businessId),
    customer: customerLookup(tx, context.companyId),
    performers: performerCheck(tx, context.companyId, context.businessId, context.branchId),
    discount: discountLimit(tx, context.companyId, context.businessId),
    requesterName: editorName(tx, context.companyId, context.businessId),
  }));
}
export function ordersDiscountDecisions(database: TenantWrappers, ids: IdGenerator) {
  return createDiscountDecisionTransactions(database, ids, (tx, context) => ({
    access: discountApprovalAccess(
      tx,
      context.companyId,
      context.userId,
      context.businessId,
      context.branchId,
    ),
    discount: discountLimit(tx, context.companyId, context.businessId),
    approverName: editorName(tx, context.companyId, context.businessId),
    performers: performerCheck(tx, context.companyId, context.businessId, context.branchId),
    fence: discountPinFence(tx, context.companyId, context.branchId),
  }));
}
export function ordersRequesterProposals(database: TenantWrappers, clock: Clock = systemClock) {
  return new RequesterDiscountProposalsQuery(
    database,
    {
      place: (tx, scope) =>
        sessionBranchBelongs(tx, scope.companyId, scope.businessId, scope.branchId),
      access: (tx, scope, at) =>
        sessionRecordAccess(
          tx,
          scope.companyId,
          scope.userId,
          scope.businessId,
          scope.branchId,
        ).read(at),
    },
    clock,
  );
}
export function ordersPendingProposals(database: TenantWrappers, clock: Clock = systemClock) {
  return new PendingDiscountProposalsQuery(
    database,
    {
      place: (tx, scope) =>
        sessionBranchBelongs(tx, scope.companyId, scope.businessId, scope.branchId),
      read: (tx, scope) =>
        discountApprovalListAccess(
          tx,
          scope.companyId,
          scope.userId,
          scope.businessId,
          scope.branchId,
        ),
    },
    clock,
  );
}
export function ordersDeviceProposals(database: TenantWrappers, clock: Clock = systemClock) {
  return new DeviceDiscountProposalsQuery(database, clock, {
    businessOf: (tx, scope) => discountDeviceBusiness(tx, scope),
  });
}

export const ownWorkReads: OwnWorkReads = {
  context: ownWorkContext,
  periodAllowed: ownWorkPeriodAllowed,
  monthsBack: staffColumns.monthsBack,
  allowed: staffColumns.allowed,
  tipTotals: (entries) =>
    sumMonthlyTipTotalsByMethod(
      entries.map((entry) => ({
        method: entry.method,
        amount: parseMoney(entry.amount),
      })),
    ),
};

export function ordersOptionProviders(
  database: TenantWrappers | undefined,
  clock: Clock,
): Provider[] {
  return [
    {
      provide: SessionPerformerOptionsQueryHandler,
      useValue: database === undefined ? null : ordersPerformerOptionsQuery(database, clock),
    },
    {
      provide: SessionServiceOptionsQueryHandler,
      useValue: database === undefined ? null : ordersServiceOptionsQuery(database, clock),
    },
    {
      provide: RecordingContextQueryHandler,
      useValue: database === undefined ? null : ordersRecordingContextQuery(database, clock),
    },
  ];
}

export function ownWorkProviders(clock: Clock): Provider[] {
  return [
    { provide: OWN_WORK_READS, useValue: ownWorkReads },
    { provide: OWN_WORK_CLOCK, useValue: clock },
  ];
}
