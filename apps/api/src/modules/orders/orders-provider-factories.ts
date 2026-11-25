import type { InjectionToken, Provider } from '@nestjs/common';
import type { IdGenerator, TenantWrappers } from '@pospay/db';
import { editorLabel } from '@pospay/i18n';
import type { Clock } from './ports/service-session-transactions.port.ts';
import { ExtendPackageUseCase } from './use-cases/extend-package/extend-package.usecase.ts';
import { RefundPackageUseCase } from './use-cases/refund-package/refund-package.usecase.ts';
import { EditServiceLinePriceUseCase } from './use-cases/edit-service-line-price/edit-service-line-price.usecase.ts';
import { CancelServiceLineUseCase } from './use-cases/cancel-service-line/cancel-service-line.usecase.ts';
import { ChangeLinePerformersUseCase } from './use-cases/change-line-performers/change-line-performers.usecase.ts';
import { RecordSessionTipsUseCase } from './use-cases/record-session-tips/record-session-tips.usecase.ts';
import { RecordServiceSessionUseCase } from './use-cases/record-service-session/record-service-session.usecase.ts';
import { AppendServiceSessionLinesUseCase } from './use-cases/append-service-session-lines/append-service-session-lines.usecase.ts';
import { RequestDiscountApprovalUseCase } from './use-cases/request-discount-approval/request-discount-approval.usecase.ts';
import { DecideDiscountProposalsUseCase } from './use-cases/decide-discount-proposals/decide-discount-proposals.usecase.ts';
import { DecideDiscountByPinUseCase } from './use-cases/decide-discount-by-pin/decide-discount-by-pin.usecase.ts';
import { AcceptPackageSaleUseCase } from './use-cases/accept-package-sale/accept-package-sale.usecase.ts';
import { PackageSaleStatusQuery } from './queries/package-sale-status.query.ts';
import type { createPackageExtensionTransactions } from './persistence/package-extension.transactions.ts';
import type { createPackageRefundTransactions } from './persistence/package-refund.transactions.ts';
import type { createPackageSaleRequestTransactions } from './persistence/package-sale-request.transactions.ts';
import type { createServiceSessionTransactions } from './persistence/service-session-transactions.ts';
import type { createSessionRecovery } from './persistence/session-recovery.adapter.ts';
import type { termsHash } from './persistence/terms-hash.adapter.ts';
import type {
  discountPinApprover,
  DiscountPinVerifier,
} from './persistence/discount-pin-approver.adapter.ts';
import type { discountDeviceScope } from './persistence/discount-pin-fence.adapter.ts';
import type { createLineEditTransactions } from './persistence/line-edit-transactions.ts';
import type { createLineCancelTransactions } from './persistence/line-cancel-transactions.ts';
import type { createLinePerformersTransactions } from './persistence/line-performers-transactions.ts';
import type { createSessionTipsTransactions } from './persistence/session-tip-transactions.ts';
import type { createDiscountRequestTransactions } from './persistence/discount-request-transactions.ts';
import type { createDiscountDecisionTransactions } from './persistence/discount-decision-transactions.ts';
import type { DiscountDeciderSnapshot } from './domain/discount-decision-plan.ts';
import { CustomerPackagesQueryHandler } from './queries/customer-packages.query.ts';
import { CustomerPackageDetailQueryHandler } from './queries/package-entitlement-detail.query.ts';
import type { sessionPlace } from './persistence/session-place.adapter.ts';
import type { packageExtendCapability } from './persistence/session-edit-access.adapter.ts';

export function valueProvider(provide: InjectionToken, useValue: unknown): Provider {
  return { provide, useValue };
}

export function databaseProvider<T, A extends unknown[]>(
  provide: InjectionToken,
  database: TenantWrappers | undefined,
  create: (database: TenantWrappers, ...args: A) => T,
  ...args: A
): Provider {
  return valueProvider(provide, database === undefined ? null : create(database, ...args));
}

export function decisionLabels(snapshot: DiscountDeciderSnapshot) {
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

export function customerPackageReaders(adapters: {
  place: typeof sessionPlace;
}): ConstructorParameters<typeof CustomerPackagesQueryHandler>[1] {
  return {
    place: (tx, scope) =>
      adapters.place(tx, scope.companyId, scope.businessId, scope.branchId).branchTimezone(),
  };
}

export function customerPackageDetailReaders(adapters: {
  place: typeof sessionPlace;
  canExtend: typeof packageExtendCapability;
}): ConstructorParameters<typeof CustomerPackageDetailQueryHandler>[1] {
  return {
    ...customerPackageReaders(adapters),
    canExtend: (tx, scope, at) =>
      adapters.canExtend(tx, scope.companyId, scope.userId, scope.businessId, scope.branchId, at),
  };
}

export type OrdersWrites = {
  transactions: ReturnType<typeof createServiceSessionTransactions>;
  recovery: ReturnType<typeof createSessionRecovery>;
} | null;

export function extendPackageValue(
  database: TenantWrappers,
  ids: IdGenerator,
  clock: Clock,
  transactions: typeof createPackageExtensionTransactions,
) {
  return new ExtendPackageUseCase(transactions(database), ids, clock);
}
export function refundPackageValue(
  database: TenantWrappers,
  ids: IdGenerator,
  clock: Clock,
  transactions: typeof createPackageRefundTransactions,
) {
  return new RefundPackageUseCase(transactions(database, ids), ids, clock);
}
export function recordSessionValue(writes: OrdersWrites, ids: IdGenerator, clock: Clock) {
  return writes === null
    ? null
    : new RecordServiceSessionUseCase(writes.transactions, writes.recovery, ids, clock);
}
export function appendSessionValue(writes: OrdersWrites, ids: IdGenerator, clock: Clock) {
  return writes === null
    ? null
    : new AppendServiceSessionLinesUseCase(writes.transactions, writes.recovery, ids, clock);
}
export function editLineValue(
  database: TenantWrappers,
  ids: IdGenerator,
  clock: Clock,
  edits: (database: TenantWrappers) => ReturnType<typeof createLineEditTransactions>,
) {
  return new EditServiceLinePriceUseCase(edits(database), ids, clock);
}
export function cancelLineValue(
  database: TenantWrappers,
  ids: IdGenerator,
  clock: Clock,
  cancels: (database: TenantWrappers) => ReturnType<typeof createLineCancelTransactions>,
) {
  return new CancelServiceLineUseCase(cancels(database), ids, clock);
}
export function changePerformersValue(
  database: TenantWrappers,
  ids: IdGenerator,
  clock: Clock,
  performers: (database: TenantWrappers) => ReturnType<typeof createLinePerformersTransactions>,
) {
  return new ChangeLinePerformersUseCase(performers(database), ids, clock);
}
export function recordTipsValue(
  database: TenantWrappers,
  ids: IdGenerator,
  clock: Clock,
  tips: (database: TenantWrappers) => ReturnType<typeof createSessionTipsTransactions>,
) {
  return new RecordSessionTipsUseCase(tips(database), ids, clock);
}
export function requestDiscountValue(
  database: TenantWrappers,
  ids: IdGenerator,
  clock: Clock,
  requests: (
    database: TenantWrappers,
    ids: IdGenerator,
  ) => ReturnType<typeof createDiscountRequestTransactions>,
  hash: typeof termsHash,
) {
  return new RequestDiscountApprovalUseCase(requests(database, ids), ids, clock, hash());
}
export function decideDiscountValue(
  database: TenantWrappers,
  ids: IdGenerator,
  clock: Clock,
  decisions: (
    database: TenantWrappers,
    ids: IdGenerator,
  ) => ReturnType<typeof createDiscountDecisionTransactions>,
  labels: typeof decisionLabels,
) {
  return new DecideDiscountProposalsUseCase(decisions(database, ids), clock, labels);
}
export function decidePinValue(
  database: TenantWrappers | undefined,
  verifier: DiscountPinVerifier | null,
  decide: DecideDiscountProposalsUseCase | null,
  approver: typeof discountPinApprover,
  deviceScope: typeof discountDeviceScope,
) {
  return database === undefined || decide === null
    ? null
    : new DecideDiscountByPinUseCase(approver(verifier), deviceScope(database), decide);
}
export function customerPackagesValue(
  database: TenantWrappers,
  clock: Clock,
  place: typeof sessionPlace,
) {
  return new CustomerPackagesQueryHandler(database, customerPackageReaders({ place }), clock);
}
export function customerPackageDetailValue(
  database: TenantWrappers,
  clock: Clock,
  place: typeof sessionPlace,
  canExtend: typeof packageExtendCapability,
) {
  return new CustomerPackageDetailQueryHandler(
    database,
    customerPackageDetailReaders({ place, canExtend }),
    clock,
  );
}
export function acceptPackageSaleValue(
  database: TenantWrappers,
  ids: IdGenerator,
  clock: Clock,
  transactions: typeof createPackageSaleRequestTransactions,
) {
  return new AcceptPackageSaleUseCase(transactions(database, ids), ids, clock);
}
export function packageSaleStatusValue(database: TenantWrappers) {
  return new PackageSaleStatusQuery(database);
}
