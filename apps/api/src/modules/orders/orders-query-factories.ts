import type { IdGenerator, TenantWrappers } from '@pospay/db';
import { parseMoney, sumMonthlyTipTotalsByMethod } from '@pospay/domain';
import type { serviceSessionErrors } from '@pospay/i18n';
import { systemClock } from '../../shared/adapters/system-clock.ts';
import { SessionPerformerOptionsQueryHandler } from './queries/session-performer-options.query.ts';
import { SessionServiceOptionsQueryHandler } from './queries/session-service-options.query.ts';
import { RecordingContextQueryHandler } from './queries/recording-context.query.ts';
import { SessionRecoveryQuery } from './queries/session-recovery.query.ts';
import { BranchDayServiceSessionsQuery } from './queries/branch-day-service-sessions.query.ts';
import { ServiceSessionCapabilitiesQuery } from './queries/service-session-capabilities.query.ts';
import { ServiceLineCancellationQuery } from './queries/service-line-cancellation.query.ts';
import { ServiceLineEditHistoryQuery } from './queries/service-line-edits.query.ts';
import { ServiceLinePerformerChangeHistoryQuery } from './queries/service-line-performer-changes.query.ts';
import { SessionTipsCurrentQuery } from './queries/session-tips-current.query.ts';
import { RequesterDiscountProposalsQuery } from './queries/requester-discount-proposals.query.ts';
import { PendingDiscountProposalsQuery } from './queries/pending-discount-proposals.query.ts';
import { DeviceDiscountProposalsQuery } from './queries/device-discount-proposals.query.ts';
import { ConfirmSessionRecoveryUseCase } from './use-cases/confirm-session-recovery/confirm-session-recovery.usecase.ts';
import type { OwnWorkReads } from './queries/own-work-context.ts';
import type { Clock } from './ports/service-session-transactions.port.ts';
import type { sessionTime } from './domain/session-time.ts';
import type { ownWorkPeriodAllowed } from './domain/own-work-period.ts';
import type { sessionServiceOptions } from './persistence/session-service-options.adapter.ts';
import type { sessionPerformerOptions } from './persistence/session-performer-options.adapter.ts';
import type {
  pickerAccess,
  recordingAccess,
  recordingLimit,
  sessionRecordCapability,
} from './persistence/recording-context.adapter.ts';
import type { catalogReader } from './persistence/catalog-reader.adapter.ts';
import type { customerLookup } from './persistence/customer-lookup.adapter.ts';
import type { performerCheck } from './persistence/performer-check.adapter.ts';
import type { discountLimit } from './persistence/discount-limit.adapter.ts';
import type { editorName } from './persistence/editor-name.adapter.ts';
import type {
  sessionBranchBelongs,
  sessionPlace,
  sessionRecordingPlace,
} from './persistence/session-place.adapter.ts';
import type {
  discountRequestAccess,
  sessionRecordAccess,
} from './persistence/session-record-access.adapter.ts';
import type {
  sessionCancelCapability,
  sessionPerformersCapability,
} from './persistence/session-edit-access.adapter.ts';
import type {
  discountApprovalListAccess,
  sessionReadAccess,
} from './persistence/session-read-access.adapter.ts';
import type { createServiceSessionTransactions } from './persistence/service-session-transactions.ts';
import type {
  bindLineEditReaders,
  createLineEditTransactions,
} from './persistence/line-edit-transactions.ts';
import type {
  bindLineCancelReaders,
  createLineCancelTransactions,
} from './persistence/line-cancel-transactions.ts';
import type {
  bindLinePerformersReaders,
  createLinePerformersTransactions,
} from './persistence/line-performers-transactions.ts';
import type { createSessionTipsTransactions } from './persistence/session-tip-transactions.ts';
import type { createDiscountRequestTransactions } from './persistence/discount-request-transactions.ts';
import type { createDiscountDecisionTransactions } from './persistence/discount-decision-transactions.ts';
import type { discountApprovalAccess } from './persistence/discount-approval-access.adapter.ts';
import type {
  sessionRecoveryPlace,
  sessionRecoveryRecord,
} from './persistence/session-recovery-read.adapter.ts';
import type { recoveryKeyHash } from './persistence/session-recovery.adapter.ts';
import type { createSessionRecoveryConfirm } from './persistence/session-recovery-confirm.adapter.ts';
import type {
  discountDeviceBusiness,
  discountPinFence,
} from './persistence/discount-pin-fence.adapter.ts';
import type { ownWorkContext } from './persistence/own-work-context.adapter.ts';
import type { staffColumns } from './persistence/staff-columns.adapter.ts';

export interface OrdersQueryAdapters {
  performerOptions: {
    time: typeof sessionTime;
    place: typeof sessionPlace;
    access: typeof pickerAccess;
    options: typeof sessionPerformerOptions;
  };
  serviceOptions: {
    place: typeof sessionPlace;
    access: typeof recordingAccess;
    options: typeof sessionServiceOptions;
  };
  recordingContext: {
    place: typeof sessionRecordingPlace;
    access: typeof pickerAccess;
    limit: typeof recordingLimit;
  };
  recovery: { place: typeof sessionRecoveryPlace; record: typeof sessionRecoveryRecord };
  sessionReads: { place: typeof sessionBranchBelongs; read: typeof sessionReadAccess };
  capabilities: {
    place: typeof sessionBranchBelongs;
    read: typeof sessionReadAccess;
    cancel: typeof sessionCancelCapability;
    performers: typeof sessionPerformersCapability;
    record: typeof sessionRecordCapability;
  };
  tipsCurrent: { access: typeof sessionRecordAccess };
  serviceSession: {
    catalog: typeof catalogReader;
    customer: typeof customerLookup;
    performers: typeof performerCheck;
    discount: typeof discountLimit;
    place: typeof sessionPlace;
    access: typeof sessionRecordAccess;
    discountMessages: typeof serviceSessionErrors.SESSION_DISCOUNT_ABOVE_LIMIT;
  };
  discountRequest: {
    place: typeof sessionPlace;
    access: typeof discountRequestAccess;
    catalog: typeof catalogReader;
    customer: typeof customerLookup;
    performers: typeof performerCheck;
    discount: typeof discountLimit;
    requesterName: typeof editorName;
  };
  discountDecision: {
    access: typeof discountApprovalAccess;
    discount: typeof discountLimit;
    approverName: typeof editorName;
    performers: typeof performerCheck;
    fence: typeof discountPinFence;
  };
  requesterProposal: { place: typeof sessionBranchBelongs; access: typeof sessionRecordAccess };
  pendingProposal: { place: typeof sessionBranchBelongs; read: typeof discountApprovalListAccess };
  deviceProposal: { businessOf: typeof discountDeviceBusiness };
  recoveryKeyHash: typeof recoveryKeyHash;
  createSessionRecoveryConfirm: typeof createSessionRecoveryConfirm;
  createLineEditTransactions: typeof createLineEditTransactions;
  bindLineEditReaders: typeof bindLineEditReaders;
  createLineCancelTransactions: typeof createLineCancelTransactions;
  bindLineCancelReaders: typeof bindLineCancelReaders;
  createLinePerformersTransactions: typeof createLinePerformersTransactions;
  bindLinePerformersReaders: typeof bindLinePerformersReaders;
  createSessionTipsTransactions: typeof createSessionTipsTransactions;
  createServiceSessionTransactions: typeof createServiceSessionTransactions;
  createDiscountRequestTransactions: typeof createDiscountRequestTransactions;
  createDiscountDecisionTransactions: typeof createDiscountDecisionTransactions;
  ownWork: {
    context: typeof ownWorkContext;
    periodAllowed: typeof ownWorkPeriodAllowed;
    monthsBack: typeof staffColumns.monthsBack;
    allowed: typeof staffColumns.allowed;
  };
}

type Scope = { companyId: string; businessId: string; branchId: string; userId: string };
type ScopedReader<TX, A extends unknown[], R> = (tx: TX, scope: Scope, ...args: A) => R;

function companyArgs<TX, A extends unknown[], R>(
  read: (tx: TX, companyId: string, ...args: A) => R,
): ScopedReader<TX, A, R> {
  return (tx, scope, ...args) => read(tx, scope.companyId, ...args);
}

function businessArgs<TX, A extends unknown[], R>(
  read: (tx: TX, companyId: string, businessId: string, ...args: A) => R,
): ScopedReader<TX, A, R> {
  return (tx, scope, ...args) => read(tx, scope.companyId, scope.businessId, ...args);
}

function branchArgs<TX, A extends unknown[], R>(
  read: (tx: TX, companyId: string, businessId: string, branchId: string, ...args: A) => R,
): ScopedReader<TX, A, R> {
  return (tx, scope, ...args) =>
    read(tx, scope.companyId, scope.businessId, scope.branchId, ...args);
}

function userArgs<TX, A extends unknown[], R>(
  read: (
    tx: TX,
    companyId: string,
    userId: string,
    businessId: string,
    branchId: string,
    ...args: A
  ) => R,
): ScopedReader<TX, A, R> {
  return (tx, scope, ...args) =>
    read(tx, scope.companyId, scope.userId, scope.businessId, scope.branchId, ...args);
}

function sessionReads(a: OrdersQueryAdapters) {
  return (): ConstructorParameters<typeof BranchDayServiceSessionsQuery>[1] => ({
    place: branchArgs(a.sessionReads.place),
    read: userArgs(a.sessionReads.read),
  });
}

function optionQueries(a: OrdersQueryAdapters) {
  return {
    ordersPerformerOptionsQuery(database: TenantWrappers, clock: Clock = systemClock) {
      const options = a.performerOptions;
      const place = branchArgs(options.place);
      return new SessionPerformerOptionsQueryHandler(
        database,
        {
          time: (occurredAt, at, timezone) =>
            options.time(new Date(occurredAt), at, timezone).occurred_at.toISOString(),
          place: (tx, scope) => place(tx, scope).read(),
          access: userArgs(options.access),
          options: branchArgs(options.options),
        },
        clock,
      );
    },
    ordersServiceOptionsQuery(database: TenantWrappers, clock: Clock = systemClock) {
      const options = a.serviceOptions;
      const place = branchArgs(options.place);
      return new SessionServiceOptionsQueryHandler(
        database,
        {
          place: (tx, scope) => place(tx, scope).read(),
          access: userArgs(options.access),
          options: branchArgs(options.options),
        },
        clock,
      );
    },
    ordersRecordingContextQuery(database: TenantWrappers, clock: Clock = systemClock) {
      const options = a.recordingContext;
      return new RecordingContextQueryHandler(
        database,
        {
          place: branchArgs(options.place),
          access: userArgs(options.access),
          limit: (tx, scope, membershipId) =>
            options.limit(tx, scope.companyId, scope.businessId, membershipId),
        },
        clock,
      );
    },
    ordersCapabilitiesQuery(database: TenantWrappers) {
      const capabilities = a.capabilities;
      return new ServiceSessionCapabilitiesQuery(database, {
        place: branchArgs(capabilities.place),
        read: userArgs(capabilities.read),
        cancel: userArgs(capabilities.cancel),
        performers: userArgs(capabilities.performers),
        record: userArgs(capabilities.record),
      });
    },
  };
}

function recoveryQueries(a: OrdersQueryAdapters) {
  return {
    ordersRecoveryQuery(database: TenantWrappers, clock: Clock = systemClock) {
      const recovery = a.recovery;
      return new SessionRecoveryQuery(
        database,
        { place: branchArgs(recovery.place), record: userArgs(recovery.record) },
        clock,
        a.recoveryKeyHash,
      );
    },
    ordersRecoveryConfirm(database: TenantWrappers, ids: IdGenerator, clock: Clock = systemClock) {
      return new ConfirmSessionRecoveryUseCase(
        a.createSessionRecoveryConfirm(database),
        ids,
        clock,
      );
    },
  };
}

function historyQueries(a: OrdersQueryAdapters) {
  const reads = sessionReads(a);
  return {
    ordersDayQuery(database: TenantWrappers) {
      return new BranchDayServiceSessionsQuery(database, reads());
    },
    ordersLineEditHistory(database: TenantWrappers) {
      return new ServiceLineEditHistoryQuery(database, reads());
    },
    ordersLinePerformerChangeHistory(database: TenantWrappers) {
      return new ServiceLinePerformerChangeHistoryQuery(database, reads());
    },
    ordersLineCancellation(database: TenantWrappers) {
      return new ServiceLineCancellationQuery(database, reads());
    },
  };
}

function sessionWriteQueries(a: OrdersQueryAdapters) {
  return {
    ordersLineEdits(database: TenantWrappers) {
      return a.createLineEditTransactions(database, a.bindLineEditReaders);
    },
    ordersLineCancels(database: TenantWrappers) {
      return a.createLineCancelTransactions(database, a.bindLineCancelReaders);
    },
    ordersLinePerformers(database: TenantWrappers) {
      return a.createLinePerformersTransactions(database, a.bindLinePerformersReaders);
    },
    ordersSessionTips(database: TenantWrappers) {
      return a.createSessionTipsTransactions(database);
    },
    ordersSessionTipsCurrent(database: TenantWrappers, clock: Clock = systemClock) {
      const access = userArgs(a.tipsCurrent.access);
      return new SessionTipsCurrentQuery(
        database,
        { access: (tx, scope, at) => access(tx, scope).read(at) },
        clock,
      );
    },
    ordersTransactions(database: TenantWrappers, ids: IdGenerator, clock: Clock = systemClock) {
      const transactions = a.serviceSession;
      return a.createServiceSessionTransactions(
        database,
        ids,
        (tx, context) => ({
          catalog: businessArgs(transactions.catalog)(tx, context),
          customer: companyArgs(transactions.customer)(tx, context),
          performers: branchArgs(transactions.performers)(tx, context),
          discount: businessArgs(transactions.discount)(tx, context),
          place: branchArgs(transactions.place)(tx, context),
          access: userArgs(transactions.access)(tx, context),
          discountMessages: transactions.discountMessages,
        }),
        clock,
      );
    },
  };
}

function discountWriteQueries(a: OrdersQueryAdapters) {
  return {
    ordersDiscountRequests(database: TenantWrappers, ids: IdGenerator) {
      const request = a.discountRequest;
      return a.createDiscountRequestTransactions(database, ids, (tx, context) => ({
        place: branchArgs(request.place)(tx, context),
        access: userArgs(request.access)(tx, context),
        catalog: businessArgs(request.catalog)(tx, context),
        customer: companyArgs(request.customer)(tx, context),
        performers: branchArgs(request.performers)(tx, context),
        discount: businessArgs(request.discount)(tx, context),
        requesterName: businessArgs(request.requesterName)(tx, context),
      }));
    },
    ordersDiscountDecisions(database: TenantWrappers, ids: IdGenerator) {
      const decision = a.discountDecision;
      return a.createDiscountDecisionTransactions(database, ids, (tx, context) => ({
        access: userArgs(decision.access)(tx, context),
        discount: businessArgs(decision.discount)(tx, context),
        approverName: businessArgs(decision.approverName)(tx, context),
        performers: branchArgs(decision.performers)(tx, context),
        fence: decision.fence(tx, context.companyId, context.branchId),
      }));
    },
  };
}

function proposalQueries(a: OrdersQueryAdapters) {
  return {
    ordersRequesterProposals(database: TenantWrappers, clock: Clock = systemClock) {
      const proposal = a.requesterProposal;
      const access = userArgs(proposal.access);
      return new RequesterDiscountProposalsQuery(
        database,
        {
          place: branchArgs(proposal.place),
          access: (tx, scope, at) => access(tx, scope).read(at),
        },
        clock,
      );
    },
    ordersPendingProposals(database: TenantWrappers, clock: Clock = systemClock) {
      const proposal = a.pendingProposal;
      return new PendingDiscountProposalsQuery(
        database,
        { place: branchArgs(proposal.place), read: userArgs(proposal.read) },
        clock,
      );
    },
    ordersDeviceProposals(database: TenantWrappers, clock: Clock = systemClock) {
      return new DeviceDiscountProposalsQuery(database, clock, {
        businessOf: (tx, scope) => a.deviceProposal.businessOf(tx, scope),
      });
    },
  };
}

export function createOrdersQueryFactories(a: OrdersQueryAdapters) {
  return {
    ...optionQueries(a),
    ...recoveryQueries(a),
    ...historyQueries(a),
    ...sessionWriteQueries(a),
    ...discountWriteQueries(a),
    ...proposalQueries(a),
    ownWorkReads: {
      context: a.ownWork.context,
      periodAllowed: a.ownWork.periodAllowed,
      monthsBack: a.ownWork.monthsBack,
      allowed: a.ownWork.allowed,
      tipTotals: (entries) =>
        sumMonthlyTipTotalsByMethod(
          entries.map((entry) => ({ method: entry.method, amount: parseMoney(entry.amount) })),
        ),
    } satisfies OwnWorkReads,
  };
}
