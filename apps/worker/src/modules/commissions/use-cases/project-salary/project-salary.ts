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
  CommissionPeriodRolledOverError,
  CommissionTipSalaryInputInvalidError,
} from '../../domain/errors.ts';
import {
  type CommissionCorrectionScope,
  type CommissionBlockNotices,
  postCommissionCorrections,
  selectCommissionCorrectionTargets,
} from '@pospay/commissions-posting';
import type { CommissionInputEventEnvelope } from '../../ports/commission-line-projection.port.ts';
import type {
  Clock,
  CommissionSalaryProjectionScope,
  IdGenerator,
} from '../../ports/commission-tip-salary-projection.port.ts';

export interface ProjectSalaryInput extends Omit<CommissionSalaryInputEvent, 'businessId'> {
  readonly companyId: string;
  readonly businessId: string | null;
  readonly eventId: string;
}

/** يطبّق أحدث راتب على مدى شهور سريانه، وينشر تصحيحات المغلقة، ويعيد فتح المراجعة. */
export class ProjectSalary {
  constructor(
    private readonly scope: CommissionSalaryProjectionScope,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly corrections: CommissionCorrectionScope,
    private readonly notices: CommissionBlockNotices,
  ) {}

  async execute(input: ProjectSalaryInput): Promise<void> {
    await this.scope.lockEmployee(input.employeeId);
    await this.scope.lockSalaryIdentity(input.employeeId, input.effectiveFrom);
    const businessId = await this.resolveBusiness(input);
    const event: CommissionSalaryInputEvent = { ...input, businessId };
    const held = await this.scope.readSalary(input.employeeId, input.effectiveFrom);
    if (held !== null && input.revision <= held.revision) return;
    const outcome = reduceCommissionSalaries(held === null ? [] : [held], event);
    if (!outcome.applied) return;
    const row = outcome.row;
    if (row === null) return;
    assertSalaryIdentityUnchanged(held, event);
    const calendar = await this.scope.businessCalendar(input.companyId, businessId);
    if (calendar === null) throw new CommissionBusinessMissingError(businessId);
    const plannedPeriod = currentBusinessPeriod(this.clock.now(), calendar.timeZone);
    const startPeriod = currentBusinessPeriod(calendar.createdAt, calendar.timeZone);
    const nextFrom = await this.scope.readNextEffectiveFrom(input.employeeId, input.effectiveFrom);
    const affected = salaryAffectedPeriods(
      input.effectiveFrom,
      nextFrom,
      plannedPeriod,
      startPeriod,
    );
    const plan = commissionPeriodLockPlan(affected, plannedPeriod);
    const locked = await this.scope.lockPeriods({
      businessId,
      periods: plan.periodsToLock,
      ids: this.ids,
    });
    const currentPeriod = currentBusinessPeriod(this.clock.now(), calendar.timeZone);
    if (currentPeriod !== plannedPeriod) {
      throw new CommissionPeriodRolledOverError(plannedPeriod, currentPeriod);
    }
    const { closed, reviewed } = classifyCommissionPeriods(locked, plan.affectedPeriods);
    const targets = selectCommissionCorrectionTargets(locked, closed, currentPeriod);
    await this.scope.upsertSalary({ ...row, id: this.ids.newId() });
    await postCommissionCorrections({
      scope: this.corrections,
      businessId,
      eventId: input.eventId,
      targets,
      employees: closed.map((period) => ({ period, employeeId: input.employeeId })),
      companyId: input.companyId,
      notices: this.notices,
    });
    await this.scope.reopenReviewed({ businessId, periods: reviewed });
  }

  private async resolveBusiness(input: ProjectSalaryInput): Promise<string> {
    if (input.businessId !== null) return input.businessId;
    const businessId = await this.scope.employeeBusiness(input.companyId, input.employeeId);
    if (businessId === null) throw new CommissionEmployeeBusinessMissingError(input.employeeId);
    return businessId;
  }
}

/**
 * يحوّل حدث الراتب لمدخل الإسقاط؛ هويتا الموظفة والنشاط بتتوحّدان لأحرف صغيرة هنا عند حدود الحدث، لأن العقد
 * بيقبل UUID بأي حالة أحرف والـ jsonb بيحفظها كما اتبعتت، والتجميع والمقارنة بعد كده بالنص الخام
 * (النشاط بيتقارن بنص uuid من قاعدة البيانات عند مطابقة منحة مستلمي إشعار الحجب).
 *
 * @param event غلاف الحدث، وتجمّعه لازم يطابق الموظفة بلا حساسية للحالة
 * @param payload حمولة SalaryChanged بعد التحقق بالعقد
 * @returns مدخل الإسقاط بهويتي الموظفة والنشاط الصغيرتين (النشاط null لو غاب من الحدث)
 */
export function normalizeSalaryEvent(
  event: CommissionInputEventEnvelope,
  payload: SalaryChanged,
): ProjectSalaryInput {
  if (
    event.aggregateType !== 'employee' ||
    event.aggregateId.toLowerCase() !== payload.employee_id.toLowerCase()
  ) {
    throw new CommissionTipSalaryInputInvalidError('AGGREGATE_MISMATCH');
  }
  return {
    companyId: event.companyId,
    eventId: event.id,
    businessId: payload.business_id?.toLowerCase() ?? null,
    employeeId: payload.employee_id.toLowerCase(),
    effectiveFrom: payload.effective_from,
    amount: payload.amount,
    revision: payload.revision,
  };
}
