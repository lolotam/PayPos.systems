import type { SessionTipsChanged } from '@pospay/contracts';

import {
  classifyCommissionPeriods,
  commissionPeriodLockPlan,
  currentBusinessPeriod,
} from '../../domain/commission-periods.ts';
import {
  affectedCommissionTipEmployees,
  assertTipIdentityUnchanged,
  tipAffectedPeriods,
} from '../../domain/commission-tip-salary-periods.ts';
import {
  reduceCommissionTips,
  type CommissionTipInputEvent,
} from '../../domain/commission-tip-salary-inputs.ts';
import {
  CommissionBusinessMissingError,
  CommissionPeriodRolledOverError,
  CommissionTipSalaryInputInvalidError,
} from '../../domain/errors.ts';
import {
  CommissionPeriodClosedError,
  type CommissionCorrectionScope,
  type CommissionBlockNotices,
  postCommissionCorrections,
  selectCommissionCorrectionTargets,
} from '@pospay/commissions-posting';
import type { CommissionInputEventEnvelope } from '../../ports/commission-line-projection.port.ts';
import type {
  Clock,
  CommissionTipProjectionScope,
  IdGenerator,
} from '../../ports/commission-tip-salary-projection.port.ts';

export interface ProjectSessionTipsInput extends CommissionTipInputEvent {
  readonly companyId: string;
  readonly eventId: string | null;
}

/** يطبّق أحدث بقشيش للجلسة، وينشر تصحيحات الشهور المغلقة، ويعيد فتح الشهور المراجعة. */
export class ProjectSessionTips {
  constructor(
    private readonly scope: CommissionTipProjectionScope,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly corrections: CommissionCorrectionScope,
    private readonly notices: CommissionBlockNotices,
  ) {}

  async execute(input: ProjectSessionTipsInput): Promise<void> {
    await this.scope.lockSession(input.sessionId);
    const held = await this.scope.readTipSession(input.sessionId);
    if (held !== null && input.revision <= held.revision) return;
    const outcome = reduceCommissionTips(held === null ? [] : [held], input);
    if (!outcome.applied) return;
    const session = outcome.session;
    if (session === null) return;
    assertTipIdentityUnchanged(held, input);
    const timeZone = await this.scope.businessTimeZone(input.companyId, input.businessId);
    if (timeZone === null) throw new CommissionBusinessMissingError(input.businessId);
    const plannedPeriod = currentBusinessPeriod(this.clock.now(), timeZone);
    const affected = tipAffectedPeriods(held?.period ?? null, input.businessDate);
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
    // تهيئة البقشيش بلا حدث لا تنشر تصحيحاً بلا معرّف سبب، فتُرفض قبل أي كتابة حين لمس شهراً مغلقاً (CS-Q45).
    if (closed.length > 0 && input.eventId === null) throw new CommissionPeriodClosedError(closed);
    const targets = selectCommissionCorrectionTargets(locked, closed, currentPeriod);
    const employees = affectedCommissionTipEmployees(held, session, closed);
    await this.scope.replaceTipSession(session);
    await postCommissionCorrections({
      scope: this.corrections,
      businessId: input.businessId,
      // الأهداف الفارغة وحدها تصل إلى هنا بلا حدث، فالقيمة البديلة لا تُقرأ أصلاً.
      eventId: input.eventId ?? '',
      targets,
      employees,
      companyId: input.companyId,
      notices: this.notices,
    });
    await this.scope.reopenReviewed({ businessId: input.businessId, periods: reviewed });
  }
}

/**
 * يحوّل حدث بقشيش الجلسة لمدخل الإسقاط؛ هوية كل موظفة في بنود البقشيش بتتوحّد لأحرف صغيرة هنا عند حدود الحدث.
 * عقد SessionTipsChanged بيوحّدها أصلاً قبل وصول الحمولة هنا، فالسطر ده طبقة تانية خلف العقد: بيحمي لو
 * اتغيّر العقد أو اتنادت الدالة بحمولة ما عدّتش عليه، لأن التجميع بالنص الخام وإسقاط المراجعة السابقة جاي
 * من قاعدة البيانات بأحرف صغيرة، فاختلاف الحالة كان هيطلع زوجين لنفس الموظفة والشهر.
 *
 * @param event غلاف الحدث، وتجمّعه لازم يطابق الجلسة بلا حساسية للحالة
 * @param payload حمولة SessionTipsChanged بعد التحقق بالعقد
 * @returns مدخل الإسقاط ببنود بقشيش بهويات موظفات صغيرة
 */
export function normalizeSessionTipsEvent(
  event: CommissionInputEventEnvelope,
  payload: SessionTipsChanged,
): ProjectSessionTipsInput {
  if (
    event.aggregateType !== 'service_session' ||
    event.aggregateId.toLowerCase() !== payload.session_id.toLowerCase()
  ) {
    throw new CommissionTipSalaryInputInvalidError('AGGREGATE_MISMATCH');
  }
  return {
    companyId: event.companyId,
    eventId: event.id,
    businessId: payload.business_id,
    branchId: payload.branch_id,
    sessionId: payload.session_id,
    businessDate: payload.business_date,
    revision: payload.revision,
    tips: payload.tips.map((tip) => ({
      employeeId: tip.employee_id.toLowerCase(),
      method: tip.method,
      amount: tip.amount,
    })),
  };
}
