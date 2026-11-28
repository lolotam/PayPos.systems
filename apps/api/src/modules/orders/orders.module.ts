import type { Provider, Type } from '@nestjs/common';
import type { IdGenerator, TenantWrappers } from '@pospay/db';
import { serviceSessionErrors } from '@pospay/i18n';
import { systemClock } from '../../shared/adapters/system-clock.ts';
import { SelectedCompanyGuard } from '../../shared/selected-company.guard.ts';
import { DISCOUNT_APPROVER_VERIFIER } from '../../shared/discount-approver-pin.ts';
import { PackageExtensionController } from './http/package-extension.controller.ts';
import { PackageRefundController } from './http/package-refund.controller.ts';
import { SessionRecoveryController } from './http/session-recovery.controller.ts';
import { ServiceSessionsController } from './http/service-sessions.controller.ts';
import { ServiceSessionFormController } from './http/service-session-form.controller.ts';
import { SessionTipsController } from './http/session-tips.controller.ts';
import { DiscountProposalsController } from './http/discount-proposals.controller.ts';
import { DeviceDiscountProposalsController } from './http/device-discount-proposals.controller.ts';
import { OwnWorkController, OWN_WORK_CLOCK } from './http/own-work.controller.ts';
import { PackageSalesController } from './http/package-sales.controller.ts';
import { PackageSaleContextController } from './http/package-sale-context.controller.ts';
import { CustomerPackagesController } from './http/customer-packages.controller.ts';
import { ExtendPackageUseCase } from './use-cases/extend-package/extend-package.usecase.ts';
import { RefundPackageUseCase } from './use-cases/refund-package/refund-package.usecase.ts';
import { AcceptPackageSaleUseCase } from './use-cases/accept-package-sale/accept-package-sale.usecase.ts';
import { ConfirmSessionRecoveryUseCase } from './use-cases/confirm-session-recovery/confirm-session-recovery.usecase.ts';
import { RecordServiceSessionUseCase } from './use-cases/record-service-session/record-service-session.usecase.ts';
import { AppendServiceSessionLinesUseCase } from './use-cases/append-service-session-lines/append-service-session-lines.usecase.ts';
import { EditServiceLinePriceUseCase } from './use-cases/edit-service-line-price/edit-service-line-price.usecase.ts';
import { CancelServiceLineUseCase } from './use-cases/cancel-service-line/cancel-service-line.usecase.ts';
import { ChangeLinePerformersUseCase } from './use-cases/change-line-performers/change-line-performers.usecase.ts';
import { RecordSessionTipsUseCase } from './use-cases/record-session-tips/record-session-tips.usecase.ts';
import { RequestDiscountApprovalUseCase } from './use-cases/request-discount-approval/request-discount-approval.usecase.ts';
import { DecideDiscountProposalsUseCase } from './use-cases/decide-discount-proposals/decide-discount-proposals.usecase.ts';
import { DecideDiscountByPinUseCase } from './use-cases/decide-discount-by-pin/decide-discount-by-pin.usecase.ts';
import { RecordingContextQueryHandler } from './queries/recording-context.query.ts';
import { SessionServiceOptionsQueryHandler } from './queries/session-service-options.query.ts';
import { SessionPerformerOptionsQueryHandler } from './queries/session-performer-options.query.ts';
import { BranchDayServiceSessionsQuery } from './queries/branch-day-service-sessions.query.ts';
import { ServiceSessionCapabilitiesQuery } from './queries/service-session-capabilities.query.ts';
import { ServiceLineCancellationQuery } from './queries/service-line-cancellation.query.ts';
import { ServiceLineEditHistoryQuery } from './queries/service-line-edits.query.ts';
import { ServiceLinePerformerChangeHistoryQuery } from './queries/service-line-performer-changes.query.ts';
import { SessionTipsCurrentQuery } from './queries/session-tips-current.query.ts';
import { SessionRecoveryQuery } from './queries/session-recovery.query.ts';
import { RequesterDiscountProposalsQuery } from './queries/requester-discount-proposals.query.ts';
import { PendingDiscountProposalsQuery } from './queries/pending-discount-proposals.query.ts';
import { DeviceDiscountProposalsQuery } from './queries/device-discount-proposals.query.ts';
import { CustomerPackagesQueryHandler } from './queries/customer-packages.query.ts';
import { CustomerPackageDetailQueryHandler } from './queries/package-entitlement-detail.query.ts';
import { PackageSaleStatusQuery } from './queries/package-sale-status.query.ts';
import { PackageSaleContextQueryHandler } from './queries/package-sale-context.query.ts';
import { packageSaleContextValue } from './queries/package-sale-context.query.ts';
import { OWN_WORK_READS } from './queries/own-work-context.ts';
import { sessionTime } from './domain/session-time.ts';
import {
  packageImportControllers,
  packageImportProviders,
} from './orders-package-import-providers.ts';
import { createPackageExtensionTransactions } from './persistence/package-extension.transactions.ts';
import { createPackageRefundTransactions } from './persistence/package-refund.transactions.ts';
import { createPackageSaleRequestTransactions } from './persistence/package-sale-request.transactions.ts';
import * as saleContext from './persistence/package-sale-context.adapter.ts';
import { sessionServiceOptions } from './persistence/session-service-options.adapter.ts';
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
import {
  sessionBranchBelongs,
  sessionPlace,
  sessionRecordingPlace,
} from './persistence/session-place.adapter.ts';
import {
  discountRequestAccess,
  sessionRecordAccess,
} from './persistence/session-record-access.adapter.ts';
import {
  packageExtendCapability,
  packageRefundCapability,
  sessionCancelCapability,
  sessionPerformersCapability,
} from './persistence/session-edit-access.adapter.ts';
import {
  discountApprovalListAccess,
  sessionReadAccess,
} from './persistence/session-read-access.adapter.ts';
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
import { createSessionRecovery, recoveryKeyHash } from './persistence/session-recovery.adapter.ts';
import { createDiscountRequestTransactions } from './persistence/discount-request-transactions.ts';
import { termsHash } from './persistence/terms-hash.adapter.ts';
import { createDiscountDecisionTransactions } from './persistence/discount-decision-transactions.ts';
import { discountApprovalAccess } from './persistence/discount-approval-access.adapter.ts';
import {
  sessionRecoveryPlace,
  sessionRecoveryRecord,
} from './persistence/session-recovery-read.adapter.ts';
import { createSessionRecoveryConfirm } from './persistence/session-recovery-confirm.adapter.ts';
import {
  discountDeviceBusiness,
  discountDeviceScope,
  discountPinFence,
} from './persistence/discount-pin-fence.adapter.ts';
import {
  discountPinApprover,
  type DiscountPinVerifier,
} from './persistence/discount-pin-approver.adapter.ts';
import { ownWorkContext } from './persistence/own-work-context.adapter.ts';
import { staffColumns } from './persistence/staff-columns.adapter.ts';
import { ownWorkPeriodAllowed } from './domain/own-work-period.ts';
import { SessionAdminGuard, SessionAppendGuard } from './http/session-access.guard.ts';
import { SessionErrorsFilter } from './http/session-errors.filter.ts';
import type { Clock } from './ports/service-session-transactions.port.ts';
import { createOrdersQueryFactories } from './orders-query-factories.ts';
import {
  acceptPackageSaleValue,
  appendSessionValue,
  cancelLineValue,
  changePerformersValue,
  customerPackageDetailValue,
  customerPackagesValue,
  databaseProvider as fromDb,
  decideDiscountValue,
  decidePinValue,
  decisionLabels,
  editLineValue,
  extendPackageValue,
  packageSaleStatusValue,
  recordSessionValue,
  recordTipsValue,
  refundPackageValue,
  requestDiscountValue,
  valueProvider as value,
  type OrdersWrites,
} from './orders-provider-factories.ts';

export const ordersControllers: Type[] = [
  ...packageImportControllers,
  PackageExtensionController,
  PackageRefundController,
  SessionRecoveryController,
  ServiceSessionsController,
  ServiceSessionFormController,
  SessionTipsController,
  DiscountProposalsController,
];

ordersControllers.push(DeviceDiscountProposalsController);
ordersControllers.push(OwnWorkController);
ordersControllers.push(PackageSaleContextController);
ordersControllers.push(PackageSalesController);
ordersControllers.push(CustomerPackagesController);

const ordersQueries = createOrdersQueryFactories({
  performerOptions: {
    time: sessionTime,
    place: sessionPlace,
    access: pickerAccess,
    options: sessionPerformerOptions,
  },
  serviceOptions: { place: sessionPlace, access: recordingAccess, options: sessionServiceOptions },
  recordingContext: { place: sessionRecordingPlace, access: pickerAccess, limit: recordingLimit },
  recovery: { place: sessionRecoveryPlace, record: sessionRecoveryRecord },
  sessionReads: { place: sessionBranchBelongs, read: sessionReadAccess },
  capabilities: {
    place: sessionBranchBelongs,
    read: sessionReadAccess,
    cancel: sessionCancelCapability,
    performers: sessionPerformersCapability,
    record: sessionRecordCapability,
  },
  tipsCurrent: { access: sessionRecordAccess },
  serviceSession: {
    catalog: catalogReader,
    customer: customerLookup,
    performers: (...args) => performerCheck(...args),
    discount: discountLimit,
    place: sessionPlace,
    access: sessionRecordAccess,
    discountMessages: serviceSessionErrors.SESSION_DISCOUNT_ABOVE_LIMIT,
  },
  discountRequest: {
    place: sessionPlace,
    access: discountRequestAccess,
    catalog: catalogReader,
    customer: customerLookup,
    performers: (...args) => performerCheck(...args),
    discount: discountLimit,
    requesterName: editorName,
  },
  discountDecision: {
    access: discountApprovalAccess,
    discount: discountLimit,
    approverName: editorName,
    performers: (...args) => performerCheck(...args),
    fence: discountPinFence,
  },
  requesterProposal: { place: sessionBranchBelongs, access: sessionRecordAccess },
  pendingProposal: { place: sessionBranchBelongs, read: discountApprovalListAccess },
  deviceProposal: { businessOf: discountDeviceBusiness },
  recoveryKeyHash,
  createSessionRecoveryConfirm,
  createLineEditTransactions,
  bindLineEditReaders,
  createLineCancelTransactions,
  bindLineCancelReaders,
  createLinePerformersTransactions,
  bindLinePerformersReaders,
  createSessionTipsTransactions,
  createServiceSessionTransactions,
  createDiscountRequestTransactions,
  createDiscountDecisionTransactions,
  ownWork: {
    context: ownWorkContext,
    periodAllowed: ownWorkPeriodAllowed,
    monthsBack: staffColumns.monthsBack,
    allowed: staffColumns.allowed,
  },
});

export const {
  ordersPerformerOptionsQuery,
  ordersServiceOptionsQuery,
  ordersRecordingContextQuery,
  ordersRecoveryQuery,
  ordersRecoveryConfirm,
  ordersDayQuery,
  ordersLineEditHistory,
  ordersLinePerformerChangeHistory,
  ordersLineCancellation,
  ordersCapabilitiesQuery,
  ordersLineEdits,
  ordersLineCancels,
  ordersLinePerformers,
  ordersSessionTips,
  ordersSessionTipsCurrent,
  ordersTransactions,
  ordersDiscountRequests,
  ordersDiscountDecisions,
  ordersRequesterProposals,
  ordersPendingProposals,
  ordersDeviceProposals,
  ownWorkReads,
} = ordersQueries;

function ordersPackageCommandProviders(
  database: TenantWrappers | undefined,
  ids: IdGenerator,
  clock: Clock,
): Provider[] {
  return [
    ...packageImportProviders(database, ids, clock),
    fromDb(
      ExtendPackageUseCase,
      database,
      extendPackageValue,
      ids,
      clock,
      createPackageExtensionTransactions,
    ),
    fromDb(
      RefundPackageUseCase,
      database,
      refundPackageValue,
      ids,
      clock,
      createPackageRefundTransactions,
    ),
  ];
}

function ordersSessionProviders(
  writes: OrdersWrites,
  database: TenantWrappers | undefined,
  ids: IdGenerator,
  clock: Clock,
): Provider[] {
  return [
    fromDb(SessionPerformerOptionsQueryHandler, database, ordersPerformerOptionsQuery, clock),
    fromDb(SessionServiceOptionsQueryHandler, database, ordersServiceOptionsQuery, clock),
    fromDb(RecordingContextQueryHandler, database, ordersRecordingContextQuery, clock),
    fromDb(BranchDayServiceSessionsQuery, database, ordersDayQuery),
    fromDb(ServiceLineEditHistoryQuery, database, ordersLineEditHistory),
    fromDb(ServiceLinePerformerChangeHistoryQuery, database, ordersLinePerformerChangeHistory),
    fromDb(ServiceLineCancellationQuery, database, ordersLineCancellation),
    fromDb(ServiceSessionCapabilitiesQuery, database, ordersCapabilitiesQuery),
    fromDb(SessionRecoveryQuery, database, ordersRecoveryQuery, clock),
    fromDb(ConfirmSessionRecoveryUseCase, database, ordersRecoveryConfirm, ids, clock),
    value(RecordServiceSessionUseCase, recordSessionValue(writes, ids, clock)),
    value(AppendServiceSessionLinesUseCase, appendSessionValue(writes, ids, clock)),
    fromDb(EditServiceLinePriceUseCase, database, editLineValue, ids, clock, ordersLineEdits),
    fromDb(CancelServiceLineUseCase, database, cancelLineValue, ids, clock, ordersLineCancels),
    fromDb(
      ChangeLinePerformersUseCase,
      database,
      changePerformersValue,
      ids,
      clock,
      ordersLinePerformers,
    ),
    fromDb(RecordSessionTipsUseCase, database, recordTipsValue, ids, clock, ordersSessionTips),
    fromDb(SessionTipsCurrentQuery, database, ordersSessionTipsCurrent, clock),
  ];
}

function ordersDiscountAndPackageProviders(
  database: TenantWrappers | undefined,
  ids: IdGenerator,
  clock: Clock,
): Provider[] {
  return [
    fromDb(
      RequestDiscountApprovalUseCase,
      database,
      requestDiscountValue,
      ids,
      clock,
      ordersDiscountRequests,
      termsHash,
    ),
    fromDb(
      DecideDiscountProposalsUseCase,
      database,
      decideDiscountValue,
      ids,
      clock,
      ordersDiscountDecisions,
      decisionLabels,
    ),
    fromDb(RequesterDiscountProposalsQuery, database, ordersRequesterProposals, clock),
    fromDb(PendingDiscountProposalsQuery, database, ordersPendingProposals, clock),
    fromDb(DeviceDiscountProposalsQuery, database, ordersDeviceProposals, clock),
    {
      provide: DecideDiscountByPinUseCase,
      useFactory: (
        verifier: DiscountPinVerifier | null,
        decide: DecideDiscountProposalsUseCase | null,
      ) => decidePinValue(database, verifier, decide, discountPinApprover, discountDeviceScope),
      inject: [DISCOUNT_APPROVER_VERIFIER, DecideDiscountProposalsUseCase],
    },
    fromDb(CustomerPackagesQueryHandler, database, customerPackagesValue, clock, sessionPlace),
    fromDb(
      CustomerPackageDetailQueryHandler,
      database,
      customerPackageDetailValue,
      clock,
      sessionPlace,
      packageExtendCapability,
      packageRefundCapability,
    ),
    fromDb(
      AcceptPackageSaleUseCase,
      database,
      acceptPackageSaleValue,
      ids,
      clock,
      createPackageSaleRequestTransactions,
    ),
    fromDb(PackageSaleStatusQuery, database, packageSaleStatusValue),
    fromDb(PackageSaleContextQueryHandler, database, packageSaleContextValue, saleContext, clock),
  ];
}

export function ordersProviders(
  database: TenantWrappers | undefined,
  ids: IdGenerator,
  clock: Clock = systemClock,
): Provider[] {
  const writes =
    database === undefined
      ? null
      : {
          transactions: ordersTransactions(database, ids, clock),
          recovery: createSessionRecovery(database, ids, clock),
        };
  return [
    ...ordersPackageCommandProviders(database, ids, clock),
    SelectedCompanyGuard,
    SessionAdminGuard,
    SessionAppendGuard,
    value(SessionErrorsFilter, new SessionErrorsFilter()),
    ...ordersSessionProviders(writes, database, ids, clock),
    ...ordersDiscountAndPackageProviders(database, ids, clock),
    value(OWN_WORK_READS, ownWorkReads),
    value(OWN_WORK_CLOCK, clock),
  ];
}
