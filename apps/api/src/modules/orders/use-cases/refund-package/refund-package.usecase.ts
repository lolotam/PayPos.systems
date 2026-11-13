import type { PackageRefundResponse, RefundPackageInput } from '@pospay/contracts';
import { moneyToString } from '@pospay/domain';
import { PackageRefundError } from '../../domain/package-refund-error.ts';
import { planPackageRefund, type PackageRefundPlan } from '../../domain/package-refund-plan.ts';
import { normalizeRefundReason } from '../../domain/package-refund-reason.ts';
import { packageSaleChanged } from '../../domain/package-sale-changed.ts';
import { sessionBusinessDate } from '../../domain/session-time.ts';
import type {
  LockedRefundEntitlement,
  PackageRefundInsert,
  PackageRefundTransaction,
  PackageRefundTransactions,
} from '../../ports/package-refund.port.ts';
import type {
  Clock,
  IdGenerator,
  SessionWriteContext,
} from '../../ports/service-session-transactions.port.ts';

type RefundPackageContext = SessionWriteContext & {
  entitlementId: string;
  input: RefundPackageInput;
};

/** الخطة المقبولة بس؛ المرفوضة بترجع رمزها بدل الحسابات. */
type AcceptedRefundPlan = Extract<PackageRefundPlan, { accepted: true }>;

/** الأثر اللي بتكتبه المعاملة الواحدة: الاستحقاق المقفول والخطة والفاعل واللحظة والسبب المقصوص. */
type RefundWrite = {
  readonly entitlement: LockedRefundEntitlement;
  readonly plan: AcceptedRefundPlan;
  readonly membershipId: string;
  readonly at: Date;
  readonly id: string;
  readonly reason: string;
};

/** يسترد جلسات فاضية من مكوّن باقة ويثبت الاسترداد وأثره في معاملة واحدة. */
export class RefundPackageUseCase {
  constructor(
    private readonly transactions: PackageRefundTransactions,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(context: RefundPackageContext): Promise<PackageRefundResponse> {
    return this.transactions.run(context, async (tx) => {
      const result = await tx.idempotent(() => this.refund(tx, context));
      if (result.replayed) {
        await tx.access.lock();
        await this.authorize(tx, this.clock.now());
      }
      return result.body;
    });
  }

  private async refund(
    tx: PackageRefundTransaction,
    context: RefundPackageContext,
  ): Promise<PackageRefundResponse> {
    await tx.access.lock();
    const at = this.clock.now();
    const membershipId = await this.authorize(tx, at);
    // الوصول والميزة بيتحققوا قبل تشخيص السبب، فالخاصية المقفولة بترد 403 مهما كان السبب في الجسم.
    const reason = normalizeRefundReason(context.input.reason);
    const timezone = await tx.place.timezone();
    if (timezone === null) throw new PackageRefundError('FORBIDDEN');
    const entitlement = await this.lockEntitlement(tx, context);
    const plan = await this.planRefund(tx, context, entitlement, sessionBusinessDate(at, timezone));
    const id = this.ids.newId();
    await this.writeRefund(tx, context, { entitlement, plan, membershipId, at, id, reason });
    await this.publish(tx, context, entitlement, plan);
    return this.response(context, plan, at, id);
  }

  private async authorize(tx: PackageRefundTransaction, at: Date): Promise<string> {
    const access = await tx.access.read(at);
    const membershipId = access.eligible[0];
    if (access.denied || membershipId === undefined) throw new PackageRefundError('FORBIDDEN');
    if (!access.feature) throw new PackageRefundError('FEATURE_DISABLED');
    return membershipId;
  }

  private async lockEntitlement(
    tx: PackageRefundTransaction,
    context: RefundPackageContext,
  ): Promise<LockedRefundEntitlement> {
    const entitlement = await tx.packages.lockEntitlement(context.entitlementId);
    if (entitlement === null) throw new PackageRefundError('PACKAGE_NOT_FOUND');
    return entitlement;
  }

  private async planRefund(
    tx: PackageRefundTransaction,
    context: RefundPackageContext,
    entitlement: LockedRefundEntitlement,
    today: string,
  ): Promise<AcceptedRefundPlan> {
    const component = await tx.packages.lockComponent(
      context.entitlementId,
      context.input.component_id,
    );
    if (!component) throw new PackageRefundError('PACKAGE_COMPONENT_NOT_FOUND');
    const slots = await tx.packages.lockSlots(context.entitlementId, context.input.component_id);
    const importedEnabled =
      entitlement.provenance === 'IMPORTED' ? await tx.settings.importedRefundsEnabled() : true;
    const plan = planPackageRefund({
      provenance: entitlement.provenance,
      importedRefundsEnabled: importedEnabled,
      today,
      expiresOn: entitlement.expires_on,
      slots,
      requestedSessions: context.input.sessions,
      refundedAmount: entitlement.refunded_amount,
      revision: entitlement.revision,
    });
    if (!plan.accepted) throw new PackageRefundError('IMPORTED_REFUND_DISABLED');
    return plan;
  }

  private async writeRefund(
    tx: PackageRefundTransaction,
    context: RefundPackageContext,
    write: RefundWrite,
  ): Promise<void> {
    const { entitlement, plan, membershipId, at, id, reason } = write;
    const ordinals = plan.selectedSlots.map((slot) => slot.ordinal);
    const refund: PackageRefundInsert = {
      id,
      entitlement_id: context.entitlementId,
      component_id: context.input.component_id,
      sessions: context.input.sessions,
      amount: plan.amount,
      method: context.input.method,
      reason,
      refunded_by: context.userId,
      refunded_by_membership_id: membershipId,
      refunded_at: at,
      entitlement_revision: plan.newRevision,
    };
    await tx.packages.insertRefund(refund);
    await tx.packages.insertRefundSlots(refund, ordinals);
    await tx.packages.markSlotsRefunded(ordinals, context.input.sessions);
    const updated = await tx.packages.updateEntitlement(
      context.entitlementId,
      plan.newRefundedAmount,
      plan.newRevision,
    );
    if (!updated) throw new PackageRefundError('PACKAGE_NOT_FOUND');
    await tx.audit(this.ids.newId(), {
      entity: 'package_entitlement',
      entityId: context.entitlementId,
      action: 'package.refunded',
      before: {
        refunded_amount: moneyToString(entitlement.refunded_amount),
        revision: entitlement.revision,
      },
      after: {
        refunded_amount: moneyToString(plan.newRefundedAmount),
        revision: plan.newRevision,
        refund_id: id,
      },
    });
  }

  private async publish(
    tx: PackageRefundTransaction,
    context: RefundPackageContext,
    entitlement: LockedRefundEntitlement,
    plan: AcceptedRefundPlan,
  ): Promise<void> {
    // الخطة بتقرر هل الحدث واجب، والمصدر هو اللي يحمل لقطة البيع اللي الحدث محتاجها.
    if (!plan.publicationRequired || entitlement.provenance !== 'SOLD') return;
    await tx.emit(
      packageSaleChanged({
        saleId: context.entitlementId,
        businessId: entitlement.business_id,
        branchId: entitlement.sold_branch_id,
        soldAt: entitlement.sold_at,
        businessDate: entitlement.sold_business_date,
        sellerEmployeeId: entitlement.seller_employee_id,
        pricePaid: entitlement.price_paid,
        refundedAmount: plan.newRefundedAmount,
        revision: plan.newRevision,
      }),
    );
  }

  private response(
    context: RefundPackageContext,
    plan: AcceptedRefundPlan,
    at: Date,
    id: string,
  ): PackageRefundResponse {
    return {
      id,
      entitlement_id: context.entitlementId,
      component_id: context.input.component_id,
      sessions: context.input.sessions,
      amount: moneyToString(plan.amount),
      method: context.input.method,
      refunded_amount: moneyToString(plan.newRefundedAmount),
      revision: plan.newRevision,
      refunded_at: at.toISOString(),
    };
  }
}

export { PackageRefundError } from '../../domain/package-refund-error.ts';
export { PackageRuleError } from '../../domain/errors.ts';
export { SessionError } from '../../domain/session-error.ts';
