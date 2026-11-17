import type { Provider } from '@nestjs/common';
import type { IdGenerator, TenantWrappers } from '@pospay/db';
import { editorLabel } from '@pospay/i18n';
import { systemClock } from '../../shared/adapters/system-clock.ts';
import { SelectedCompanyGuard } from '../../shared/selected-company.guard.ts';
import { DISCOUNT_APPROVER_VERIFIER } from '../../shared/discount-approver-pin.ts';
import { RequestPackageImportPreviewUseCase } from './use-cases/request-package-import-preview/request-package-import-preview.usecase.ts';
import { createPackageImportRequestTransactions } from './persistence/package-import-request.transactions.ts';
import { ExtendPackageUseCase } from './use-cases/extend-package/extend-package.usecase.ts';
import { createPackageExtensionTransactions } from './persistence/package-extension.transactions.ts';
import { RefundPackageUseCase } from './use-cases/refund-package/refund-package.usecase.ts';
import { createPackageRefundTransactions } from './persistence/package-refund.transactions.ts';
import { AcceptPackageSaleUseCase } from './use-cases/accept-package-sale/accept-package-sale.usecase.ts';
import { createPackageSaleRequestTransactions } from './persistence/package-sale-request.transactions.ts';
import { PackageSaleStatusQuery } from './queries/package-sale-status.query.ts';
import { SessionAdminGuard, SessionAppendGuard } from './http/session-access.guard.ts';
import { SessionErrorsFilter } from './http/session-errors.filter.ts';
import { BranchDayServiceSessionsQuery } from './queries/branch-day-service-sessions.query.ts';
import { ServiceSessionCapabilitiesQuery } from './queries/service-session-capabilities.query.ts';
import { ServiceLineCancellationQuery } from './queries/service-line-cancellation.query.ts';
import { ServiceLineEditHistoryQuery } from './queries/service-line-edits.query.ts';
import { ServiceLinePerformerChangeHistoryQuery } from './queries/service-line-performer-changes.query.ts';
import { SessionTipsCurrentQuery } from './queries/session-tips-current.query.ts';
import { SessionRecoveryQuery } from './queries/session-recovery.query.ts';
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
import { RequesterDiscountProposalsQuery } from './queries/requester-discount-proposals.query.ts';
import { PendingDiscountProposalsQuery } from './queries/pending-discount-proposals.query.ts';
import { DeviceDiscountProposalsQuery } from './queries/device-discount-proposals.query.ts';
import { CustomerPackagesQueryHandler } from './queries/customer-packages.query.ts';
import { CustomerPackageDetailQueryHandler } from './queries/package-entitlement-detail.query.ts';
import { createSessionRecovery } from './persistence/session-recovery.adapter.ts';
import { termsHash } from './persistence/terms-hash.adapter.ts';
import type { DiscountDeciderSnapshot } from './domain/discount-decision-plan.ts';
import { sessionPlace } from './persistence/session-place.adapter.ts';
import { packageExtendCapability } from './persistence/session-edit-access.adapter.ts';
import { discountDeviceScope } from './persistence/discount-pin-fence.adapter.ts';
import {
  discountPinApprover,
  type DiscountPinVerifier,
} from './persistence/discount-pin-approver.adapter.ts';
import type { Clock } from './ports/service-session-transactions.port.ts';
import {
  ordersCapabilitiesQuery,
  ordersDayQuery,
  ordersDeviceProposals,
  ordersDiscountDecisions,
  ordersDiscountRequests,
  ordersLineCancellation,
  ordersLineCancels,
  ordersLineEditHistory,
  ordersLineEdits,
  ordersLinePerformerChangeHistory,
  ordersLinePerformers,
  ordersOptionProviders,
  ordersPendingProposals,
  ordersRecoveryConfirm,
  ordersRecoveryQuery,
  ordersRequesterProposals,
  ordersSessionTips,
  ordersSessionTipsCurrent,
  ordersTransactions,
  ownWorkProviders,
} from './orders-query-factories.ts';

type OrdersWrites = {
  transactions: ReturnType<typeof ordersTransactions>;
  recovery: ReturnType<typeof createSessionRecovery>;
} | null;

function ordersPackageCommandProviders(
  database: TenantWrappers | undefined,
  ids: IdGenerator,
  clock: Clock,
): Provider[] {
  return [
    {
      provide: RequestPackageImportPreviewUseCase,
      useValue:
        database === undefined
          ? null
          : new RequestPackageImportPreviewUseCase(
              createPackageImportRequestTransactions(database, ids),
              ids,
              clock,
            ),
    },
    {
      provide: ExtendPackageUseCase,
      useValue:
        database === undefined
          ? null
          : new ExtendPackageUseCase(createPackageExtensionTransactions(database), ids, clock),
    },
    {
      provide: RefundPackageUseCase,
      useValue:
        database === undefined
          ? null
          : new RefundPackageUseCase(createPackageRefundTransactions(database, ids), ids, clock),
    },
  ];
}

function ordersSessionGuardProviders(): Provider[] {
  return [
    SelectedCompanyGuard,
    SessionAdminGuard,
    SessionAppendGuard,
    { provide: SessionErrorsFilter, useValue: new SessionErrorsFilter() },
  ];
}

function ordersSessionReadProviders(
  database: TenantWrappers | undefined,
  ids: IdGenerator,
  clock: Clock,
): Provider[] {
  return [
    {
      provide: BranchDayServiceSessionsQuery,
      useValue: database === undefined ? null : ordersDayQuery(database),
    },
    {
      provide: ServiceLineEditHistoryQuery,
      useValue: database === undefined ? null : ordersLineEditHistory(database),
    },
    {
      provide: ServiceLinePerformerChangeHistoryQuery,
      useValue: database === undefined ? null : ordersLinePerformerChangeHistory(database),
    },
    {
      provide: ServiceLineCancellationQuery,
      useValue: database === undefined ? null : ordersLineCancellation(database),
    },
    {
      provide: ServiceSessionCapabilitiesQuery,
      useValue: database === undefined ? null : ordersCapabilitiesQuery(database),
    },
    {
      provide: SessionRecoveryQuery,
      useValue: database === undefined ? null : ordersRecoveryQuery(database, clock),
    },
    {
      provide: ConfirmSessionRecoveryUseCase,
      useValue: database === undefined ? null : ordersRecoveryConfirm(database, ids, clock),
    },
  ];
}

function ordersSessionWriteProviders(
  writes: OrdersWrites,
  database: TenantWrappers | undefined,
  ids: IdGenerator,
  clock: Clock,
): Provider[] {
  return [
    {
      provide: RecordServiceSessionUseCase,
      useValue:
        writes === null
          ? null
          : new RecordServiceSessionUseCase(writes.transactions, writes.recovery, ids, clock),
    },
    {
      provide: AppendServiceSessionLinesUseCase,
      useValue:
        writes === null
          ? null
          : new AppendServiceSessionLinesUseCase(writes.transactions, writes.recovery, ids, clock),
    },
    {
      provide: EditServiceLinePriceUseCase,
      useValue:
        database === undefined
          ? null
          : new EditServiceLinePriceUseCase(ordersLineEdits(database), ids, clock),
    },
    {
      provide: CancelServiceLineUseCase,
      useValue:
        database === undefined
          ? null
          : new CancelServiceLineUseCase(ordersLineCancels(database), ids, clock),
    },
    {
      provide: ChangeLinePerformersUseCase,
      useValue:
        database === undefined
          ? null
          : new ChangeLinePerformersUseCase(ordersLinePerformers(database), ids, clock),
    },
    {
      provide: RecordSessionTipsUseCase,
      useValue:
        database === undefined
          ? null
          : new RecordSessionTipsUseCase(ordersSessionTips(database), ids, clock),
    },
    {
      provide: SessionTipsCurrentQuery,
      useValue: database === undefined ? null : ordersSessionTipsCurrent(database, clock),
    },
  ];
}

function decisionLabels(snapshot: DiscountDeciderSnapshot) {
  const editor = {
    nameAr: snapshot.decider_name_ar,
    nameEn: snapshot.decider_name_en,
    role: snapshot.decider_role,
    roleIsSystem: snapshot.decider_role_is_system,
    roleNameAr: snapshot.decider_role_name_ar,
    roleNameEn: snapshot.decider_role_name_en,
  };
  return { ar: editorLabel('ar', editor), en: editorLabel('en', editor) };
}

function ordersDiscountProviders(
  database: TenantWrappers | undefined,
  ids: IdGenerator,
  clock: Clock,
): Provider[] {
  return [
    {
      provide: RequestDiscountApprovalUseCase,
      useValue:
        database === undefined
          ? null
          : new RequestDiscountApprovalUseCase(
              ordersDiscountRequests(database, ids),
              ids,
              clock,
              termsHash(),
            ),
    },
    {
      provide: DecideDiscountProposalsUseCase,
      useValue:
        database === undefined
          ? null
          : new DecideDiscountProposalsUseCase(
              ordersDiscountDecisions(database, ids),
              clock,
              decisionLabels,
            ),
    },
    {
      provide: RequesterDiscountProposalsQuery,
      useValue: database === undefined ? null : ordersRequesterProposals(database, clock),
    },
    {
      provide: PendingDiscountProposalsQuery,
      useValue: database === undefined ? null : ordersPendingProposals(database, clock),
    },
    {
      provide: DeviceDiscountProposalsQuery,
      useValue: database === undefined ? null : ordersDeviceProposals(database, clock),
    },
  ];
}

function ordersPinDecisionProvider(database: TenantWrappers | undefined): Provider[] {
  return [
    {
      provide: DecideDiscountByPinUseCase,
      useFactory: (
        verifier: DiscountPinVerifier | null,
        decide: DecideDiscountProposalsUseCase | null,
      ) =>
        database === undefined || decide === null
          ? null
          : new DecideDiscountByPinUseCase(
              discountPinApprover(verifier),
              discountDeviceScope(database),
              decide,
            ),
      inject: [DISCOUNT_APPROVER_VERIFIER, DecideDiscountProposalsUseCase],
    },
  ];
}

function customerPackageProviders(database: TenantWrappers | undefined, clock: Clock): Provider[] {
  return [
    {
      provide: CustomerPackagesQueryHandler,
      useValue:
        database === undefined
          ? null
          : new CustomerPackagesQueryHandler(
              database,
              {
                place: (tx, scope) =>
                  sessionPlace(
                    tx,
                    scope.companyId,
                    scope.businessId,
                    scope.branchId,
                  ).branchTimezone(),
              },
              clock,
            ),
    },
    {
      provide: CustomerPackageDetailQueryHandler,
      useValue:
        database === undefined
          ? null
          : new CustomerPackageDetailQueryHandler(
              database,
              {
                place: (tx, scope) =>
                  sessionPlace(
                    tx,
                    scope.companyId,
                    scope.businessId,
                    scope.branchId,
                  ).branchTimezone(),
                canExtend: (tx, scope, at) =>
                  packageExtendCapability(
                    tx,
                    scope.companyId,
                    scope.userId,
                    scope.businessId,
                    scope.branchId,
                    at,
                  ),
              },
              clock,
            ),
    },
  ];
}

function packageSaleProviders(
  database: TenantWrappers | undefined,
  ids: IdGenerator,
  clock: Clock,
): Provider[] {
  return [
    {
      provide: AcceptPackageSaleUseCase,
      useValue:
        database === undefined
          ? null
          : new AcceptPackageSaleUseCase(
              createPackageSaleRequestTransactions(database, ids),
              ids,
              clock,
            ),
    },
    {
      provide: PackageSaleStatusQuery,
      useValue: database === undefined ? null : new PackageSaleStatusQuery(database),
    },
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
    ...ordersSessionGuardProviders(),
    ...ordersOptionProviders(database, clock),
    ...ordersSessionReadProviders(database, ids, clock),
    ...ordersSessionWriteProviders(writes, database, ids, clock),
    ...ordersDiscountProviders(database, ids, clock),
    ...ordersPinDecisionProvider(database),
    ...customerPackageProviders(database, clock),
    ...packageSaleProviders(database, ids, clock),
    ...ownWorkProviders(clock),
  ];
}
