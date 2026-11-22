import type { PackageSaleChanged } from '@pospay/contracts';

import {
  classifyCommissionPeriods,
  commissionPeriodLockPlan,
  currentBusinessPeriod,
} from '../../domain/commission-periods.ts';
import {
  affectedCommissionSaleEmployees,
  assertSaleIdentityUnchanged,
  reduceCommissionSale,
  saleAffectedPeriods,
  type CommissionSaleInputEvent,
} from '../../domain/commission-sale-inputs.ts';
import {
  CommissionBusinessMissingError,
  CommissionPeriodRolledOverError,
  CommissionSaleInputInvalidError,
} from '../../domain/errors.ts';
import {
  type CommissionBlockNotices,
  type CommissionCorrectionScope,
  postCommissionCorrections,
  selectCommissionCorrectionTargets,
} from '@pospay/commissions-posting';
import type { CommissionInputEventEnvelope } from '../../ports/commission-line-projection.port.ts';
import type {
  Clock,
  CommissionSaleProjectionScope,
  IdGenerator,
} from '../../ports/commission-sale-projection.port.ts';

export interface ProjectPackageSaleInput extends CommissionSaleInputEvent {
  readonly companyId: string;
  readonly eventId: string;
}

/**
 * يطبّق أحدث بيع باقة على إسقاط العمولة بالترتيب الذي يحدده FR-015: قفل الهوية قبل أي قراءة،
 * ثم إسقاط المراجعة الأقدم أو المساوية، ثم قفل الشهور وتصنيفها، ثم كتابة الصف، ثم نشر
 * تصحيحات الشهور المغلقة وإعادة فتح المراجع.
 * الشهر المغلق ما بيرفضش الإسقاط بقى (55-1d): البيع بيتّساب في شهره الجديد، والشهر
 * المغلق بياخد تصحيحاً بالفرق بين المبلغ الجديد والمبلغ المجمّد زائد ما نُشر قبل كده.
 */
export class ProjectPackageSale {
  constructor(
    private readonly scope: CommissionSaleProjectionScope,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly corrections: CommissionCorrectionScope,
    private readonly notices: CommissionBlockNotices,
  ) {}

  async execute(input: ProjectPackageSaleInput): Promise<void> {
    await this.scope.lockSale(input.saleId);
    const held = await this.scope.readSale(input.saleId);
    if (held !== null && input.revision <= held.revision) return;
    const outcome = reduceCommissionSale(held, input);
    if (!outcome.applied) return;
    const row = outcome.row;
    if (row === null) return;
    assertSaleIdentityUnchanged(held, input);
    const timeZone = await this.scope.businessTimeZone(input.companyId, input.businessId);
    if (timeZone === null) throw new CommissionBusinessMissingError(input.businessId);
    const plannedPeriod = currentBusinessPeriod(this.clock.now(), timeZone);
    const affected = saleAffectedPeriods(held?.period ?? null, input.businessDate);
    const plan = commissionPeriodLockPlan(affected, plannedPeriod);
    const locked = await this.scope.lockPeriods({
      businessId: input.businessId,
      periods: plan.periodsToLock,
      ids: this.ids,
    });
    const currentPeriod = currentBusinessPeriod(this.clock.now(), timeZone);
    if (currentPeriod !== plannedPeriod) {
      throw new CommissionPeriodRolledOverError(plannedPeriod, currentPeriod);
    }
    const { closed, reviewed } = classifyCommissionPeriods(locked, plan.affectedPeriods);
    // الهدف بيتختار من لقطة الأقفال قبل أي كتابة، والهدف الأول هو أول شهر DRAFT بعد الشهر
    // المصدر؛ reopenReviewed بييجي بعد التصحيح فكيفي على ترتيب D-5.
    const targets = selectCommissionCorrectionTargets(locked, closed, currentPeriod);
    // أزواج الموظفة والشهر المتأثرة: البائع القديم وشهره القديم، والبائع الجديد وشهره الجديد.
    const employees = affectedCommissionSaleEmployees(held, row, closed);
    await this.scope.upsertSale({ ...row, id: this.ids.newId() });
    await postCommissionCorrections({
      scope: this.corrections,
      businessId: input.businessId,
      eventId: input.eventId,
      targets,
      employees,
      companyId: input.companyId,
      notices: this.notices,
    });
    await this.scope.reopenReviewed({ businessId: input.businessId, periods: reviewed });
  }
}

export function normalizePackageSaleEvent(
  event: CommissionInputEventEnvelope,
  payload: PackageSaleChanged,
): ProjectPackageSaleInput {
  if (
    event.aggregateType !== 'package_entitlement' ||
    event.aggregateId.toLowerCase() !== payload.sale_id.toLowerCase()
  ) {
    throw new CommissionSaleInputInvalidError('AGGREGATE_MISMATCH');
  }
  return {
    companyId: event.companyId,
    eventId: event.id,
    businessId: payload.business_id,
    branchId: payload.branch_id,
    saleId: payload.sale_id,
    sellerEmployeeId: payload.seller_employee_id,
    businessDate: payload.business_date,
    pricePaid: payload.price_paid,
    refundedAmount: payload.refunded_amount,
    status: payload.status,
    revision: payload.revision,
  };
}
