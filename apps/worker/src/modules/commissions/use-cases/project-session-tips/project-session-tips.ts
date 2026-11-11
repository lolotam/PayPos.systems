import type { SessionTipsChanged } from '@pospay/contracts';

import {
  classifyCommissionPeriods,
  commissionPeriodLockPlan,
  currentBusinessPeriod,
} from '../../domain/commission-periods.ts';
import {
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
  CommissionTipSalaryInputInvalidError,
} from '../../domain/errors.ts';
import type { CommissionInputEventEnvelope } from '../../ports/commission-line-projection.port.ts';
import type {
  Clock,
  CommissionTipProjectionScope,
  IdGenerator,
} from '../../ports/commission-tip-salary-projection.port.ts';

export interface ProjectSessionTipsInput extends CommissionTipInputEvent {
  readonly companyId: string;
}

/** يطبّق أحدث بقشيش للجلسة ويفتح مراجعة الشهور المتأثرة دون كتابة شهر مغلق. */
export class ProjectSessionTips {
  constructor(
    private readonly scope: CommissionTipProjectionScope,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: ProjectSessionTipsInput): Promise<void> {
    await this.scope.lockSession(input.sessionId);
    const held = await this.scope.readTipSession(input.sessionId);
    const outcome = reduceCommissionTips(held === null ? [] : [held], input);
    if (!outcome.applied) return;
    const session = outcome.session;
    if (session === null) return;
    assertTipIdentityUnchanged(held, input);
    const timeZone = await this.scope.businessTimeZone(input.companyId, input.businessId);
    if (timeZone === null) throw new CommissionBusinessMissingError(input.businessId);
    const currentPeriod = currentBusinessPeriod(this.clock.now(), timeZone);
    const affected = tipAffectedPeriods(held?.period ?? null, input.businessDate);
    const plan = commissionPeriodLockPlan(affected, currentPeriod);
    const locked = await this.scope.lockPeriods({
      businessId: input.businessId,
      periods: plan.periodsToLock,
      ids: this.ids,
    });
    const { closed, reviewed } = classifyCommissionPeriods(locked, plan.affectedPeriods);
    if (closed.length > 0) throw new CommissionPeriodClosedError(closed);
    await this.scope.replaceTipSession(session);
    await this.scope.reopenReviewed({ businessId: input.businessId, periods: reviewed });
  }
}

export function normalizeSessionTipsEvent(
  event: CommissionInputEventEnvelope,
  payload: SessionTipsChanged,
): ProjectSessionTipsInput {
  if (event.aggregateType !== 'service_session' || event.aggregateId !== payload.session_id) {
    throw new CommissionTipSalaryInputInvalidError('AGGREGATE_MISMATCH');
  }
  return {
    companyId: event.companyId,
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
