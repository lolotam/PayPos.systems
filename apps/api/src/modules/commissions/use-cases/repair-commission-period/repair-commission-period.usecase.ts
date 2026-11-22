import type { CommissionPeriodRepair } from '@pospay/contracts';
import { validateWireCommissionPlan } from '@pospay/commissions-engine';
import {
  postCommissionCorrections,
  selectCommissionCorrectionTargets,
} from '@pospay/commissions-posting';
import { localDate } from '@pospay/i18n';

import type { Clock } from '../../../../shared/ports/clock.port.ts';
import type { IdGenerator } from '../../../../shared/ports/id-generator.port.ts';
import { CommissionPlanVersionError } from '../../domain/errors.ts';
import {
  commissionPlanMonthsToLock,
  nextCommissionPlanVersion,
} from '../../domain/plan-periods.ts';
import type {
  CommissionPeriodRepairCommand,
  CommissionPeriodRepairScope,
  CommissionPeriodRepairTransactions,
} from '../../ports/commission-period-repair-transactions.port.ts';

/** يصلّح شهراً مقفولاً: نسخة خطة تسري في شهرها بس، وإعادة حساب ونشر التصحيح وحلّ التوقف في معاملة واحدة. */
export class RepairCommissionPeriodUseCase {
  constructor(
    private readonly transactions: CommissionPeriodRepairTransactions,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  execute(command: CommissionPeriodRepairCommand): Promise<CommissionPeriodRepair> {
    return this.transactions.run(command, (scope) =>
      repairCommissionPeriod(scope, command, this.ids, this.clock),
    );
  }
}

const monthOf = (clock: Clock, timeZone: string): string =>
  localDate(clock.now(), timeZone).slice(0, 7);

/**
 * الخطوات بترتيبها الإلزامي: التحقق، قفل الموظفة، رفض شهر خارج مدى النشاط قبل أي قفل، نداء قفل واحد تصاعدي من شهر المصدر للشهر الحالي، إعادة قراءة
 * الشهر الحالي (لو اتغيّر نرفض قابل لإعادة المحاولة بلا نداء قفل تاني)، فحص الصلاحية، شرط التصحيح الموقوف
 * NO_PLAN، تخزين النسخة، الخطوة المشتركة، التدقيق. أي خطأ بيخرج من الـ callback فيتلغي كل اللي اتكتب.
 */
export async function repairCommissionPeriod(
  scope: CommissionPeriodRepairScope,
  command: CommissionPeriodRepairCommand,
  ids: IdGenerator,
  clock: Clock,
): Promise<CommissionPeriodRepair> {
  const { period, plan } = command.input;
  const validation = validateWireCommissionPlan(plan);
  if (!validation.ok) {
    throw new CommissionPlanVersionError('COMMISSION_PLAN_INVALID', { code: validation.code });
  }
  if (!(await scope.lockEmployee())) throw new CommissionPlanVersionError('EMPLOYEE_NOT_FOUND');
  const calendar = await scope.calendar();
  if (calendar === null) throw new Error('The employee business has no timezone');
  const current = monthOf(clock, calendar.timeZone);
  // لا تصحيح موقوف قبل أول شهر للنشاط ولا في الشهر الحالي أو بعده، ونرفض قبل أي قفل لأن القفل بينشئ كشفاً لكل شهر في المدى.
  if (period < localDate(calendar.createdAt, calendar.timeZone).slice(0, 7) || period >= current) {
    throw new CommissionPlanVersionError('COMMISSION_REPAIR_NOT_ALLOWED');
  }
  const locked = await scope.lockPeriods(
    commissionPlanMonthsToLock(`${period}-01`, `${current}-01`),
  );
  if (monthOf(clock, calendar.timeZone) !== current) {
    throw new CommissionPlanVersionError('TRANSACTION_RETRY_REQUIRED');
  }
  const accessFailure = await scope.recheckAccess();
  if (accessFailure !== null) throw new CommissionPlanVersionError(accessFailure);
  const block = await scope.readOpenBlock(period);
  if (block === null || block.code !== 'NO_PLAN') {
    throw new CommissionPlanVersionError('COMMISSION_REPAIR_NOT_ALLOWED');
  }
  const stored = await scope.insert({
    id: ids.newId(),
    employee_id: command.employeeId,
    version: nextCommissionPlanVersion(await scope.latestVersion()),
    effective_from: `${period}-01`,
    whole_period: false,
    repair_period: period,
    ...plan,
    created_at: clock.now().toISOString(),
    created_by: command.userId,
  });
  await postCommissionCorrections({
    scope: scope.corrections(),
    businessId: command.businessId,
    companyId: command.companyId,
    eventId: block.firstEventId,
    targets: selectCommissionCorrectionTargets(locked, [period], current),
    employees: [{ period, employeeId: command.employeeId }],
  });
  const state = await scope.readBlock(block.id);
  await scope.audit(stored, state);
  return { version: stored, blocked_correction: state };
}
