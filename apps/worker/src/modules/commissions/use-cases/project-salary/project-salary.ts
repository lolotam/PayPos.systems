import type { SalaryChanged } from '@pospay/contracts';

import {
  classifyCommissionPeriods,
  commissionPeriodLockPlan,
  currentBusinessPeriod,
} from '../../domain/commission-periods.ts';
import {
  assertSalaryIdentityUnchanged,
  salaryAffectedPeriods,
} from '../../domain/commission-tip-salary-periods.ts';
import {
  reduceCommissionSalaries,
  type CommissionSalaryInputEvent,
} from '../../domain/commission-tip-salary-inputs.ts';
import {
  CommissionBusinessMissingError,
  CommissionEmployeeBusinessMissingError,
  CommissionPeriodClosedError,
  CommissionTipSalaryInputInvalidError,
} from '../../domain/errors.ts';
import type { CommissionInputEventEnvelope } from '../../ports/commission-line-projection.port.ts';
import type {
  Clock,
  CommissionSalaryProjectionScope,
  IdGenerator,
} from '../../ports/commission-tip-salary-projection.port.ts';

export interface ProjectSalaryInput extends Omit<CommissionSalaryInputEvent, 'businessId'> {
  readonly companyId: string;
  readonly businessId: string | null;
}

/** يطبّق أحدث راتب على مدى شهور سريانه ويفتح مراجعة الشهور المتأثرة فقط. */
export class ProjectSalary {
  constructor(
    private readonly scope: CommissionSalaryProjectionScope,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: ProjectSalaryInput): Promise<void> {
    await this.scope.lockEmployee(input.employeeId);
    await this.scope.lockSalaryIdentity(input.employeeId, input.effectiveFrom);
    const businessId = await this.resolveBusiness(input);
    const event: CommissionSalaryInputEvent = { ...input, businessId };
    const held = await this.scope.readSalary(input.employeeId, input.effectiveFrom);
    const outcome = reduceCommissionSalaries(held === null ? [] : [held], event);
    if (!outcome.applied) return;
    const row = outcome.row;
    if (row === null) return;
    assertSalaryIdentityUnchanged(held, event);
    const calendar = await this.scope.businessCalendar(input.companyId, businessId);
    if (calendar === null) throw new CommissionBusinessMissingError(businessId);
    const currentPeriod = currentBusinessPeriod(this.clock.now(), calendar.timeZone);
    const startPeriod = currentBusinessPeriod(calendar.createdAt, calendar.timeZone);
    const nextFrom = await this.scope.readNextEffectiveFrom(input.employeeId, input.effectiveFrom);
    const affected = salaryAffectedPeriods(input.effectiveFrom, nextFrom, currentPeriod, startPeriod);
    const plan = commissionPeriodLockPlan(affected, currentPeriod);
    const locked = await this.scope.lockPeriods({
      businessId,
      periods: plan.periodsToLock,
      ids: this.ids,
    });
    const { closed, reviewed } = classifyCommissionPeriods(locked, plan.affectedPeriods);
    if (closed.length > 0) throw new CommissionPeriodClosedError(closed);
    await this.scope.upsertSalary({ ...row, id: this.ids.newId() });
    await this.scope.reopenReviewed({ businessId, periods: reviewed });
  }

  private async resolveBusiness(input: ProjectSalaryInput): Promise<string> {
    if (input.businessId !== null) return input.businessId;
    const businessId = await this.scope.employeeBusiness(input.companyId, input.employeeId);
    if (businessId === null) throw new CommissionEmployeeBusinessMissingError(input.employeeId);
    return businessId;
  }
}

export function normalizeSalaryEvent(
  event: CommissionInputEventEnvelope,
  payload: SalaryChanged,
): ProjectSalaryInput {
  if (event.aggregateType !== 'employee' || event.aggregateId !== payload.employee_id) {
    throw new CommissionTipSalaryInputInvalidError('AGGREGATE_MISMATCH');
  }
  return {
    companyId: event.companyId,
    businessId: payload.business_id ?? null,
    employeeId: payload.employee_id,
    effectiveFrom: payload.effective_from,
    amount: payload.amount,
    revision: payload.revision,
  };
}
