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
  CommissionPeriodClosedError,
  CommissionPeriodRolledOverError,
  CommissionTipSalaryInputInvalidError,
} from '../../domain/errors.ts';
import type { CommissionCorrectionScope } from '../../ports/commission-correction.port.ts';
import type { CommissionBlockNotices } from '../../ports/commission-block-notice.port.ts';
import type { CommissionInputEventEnvelope } from '../../ports/commission-line-projection.port.ts';
import type {
  Clock,
  CommissionTipProjectionScope,
  IdGenerator,
} from '../../ports/commission-tip-salary-projection.port.ts';
import {
  postCommissionCorrections,
  selectCommissionCorrectionTargets,
} from '../post-commission-corrections/post-commission-corrections.ts';

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
      employeeId: tip.employee_id,
      method: tip.method,
      amount: tip.amount,
    })),
  };
}
