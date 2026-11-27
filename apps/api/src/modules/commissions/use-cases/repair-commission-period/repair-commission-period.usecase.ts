import { validateWireCommissionPlan } from '@pospay/commissions-engine';
import {
  CommissionPeriodClosedError,
  postCommissionCorrections,
  selectCommissionCorrectionTargets,
} from '@pospay/commissions-posting';
import { sessionBusinessDate } from '@pospay/domain';

import type { Clock } from '../../../../shared/ports/clock.port.ts';
import type { IdGenerator } from '../../../../shared/ports/id-generator.port.ts';
import { CommissionPlanVersionError } from '../../domain/errors.ts';
import type { CommissionPeriodRepairSaved } from '../../events/published.ts';
import {
  assertCommissionRepairPeriodAllowed,
  commissionPlanMonthsToLock,
  nextCommissionPlanVersion,
} from '../../domain/plan-periods.ts';
import type {
  CommissionPeriodRepairCommand,
  CommissionPeriodRepairResult,
  CommissionPeriodRepairScope,
  CommissionPeriodRepairTransactions,
  CommissionRepairOpenBlock,
  CommissionRepairVersion,
} from '../../ports/commission-period-repair-transactions.port.ts';

/** يصلّح شهراً مقفولاً: نسخة خطة تسري في شهرها بس، وإعادة حساب ونشر التصحيح وحلّ التوقف في معاملة واحدة. */
export class RepairCommissionPeriodUseCase {
  constructor(
    private readonly transactions: CommissionPeriodRepairTransactions,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  execute(command: CommissionPeriodRepairCommand): Promise<CommissionPeriodRepairResult> {
    return this.transactions.run(command, (scope) =>
      repairCommissionPeriod(scope, command, this.ids, this.clock),
    );
  }
}

const monthOf = (clock: Clock, timeZone: string): string =>
  sessionBusinessDate(clock.now(), timeZone).slice(0, 7);

/**
 * الخطوات بترتيبها الإلزامي: التحقق، رفض شهر خارج مدى النشاط (قبل أي قفل لأنه مبني على التقويم مش على حالة بتتغيّر)، قفل الموظفة،
 * نداء قفل واحد تصاعدي من شهر المصدر للشهر الحالي، إعادة قراءة الشهر الحالي (لو اتغيّر نرفض قابل لإعادة المحاولة بلا نداء قفل تاني)،
 * فحص الصلاحية، ثم شرط التصحيح الموقوف NO_PLAN: القرار الحاسم بيجي من القراءة تحت الأقفال بس، لأن الـ worker ممكن يكون ماسك الشهر
 * وبيسجّل التوقف أو بيقلب كوده، فأي قراءة قبل الأقفال بتشوف آخر حالة متثبتة وبتغيّر القرار. بعد كده تخزين النسخة، الخطوة المشتركة،
 * التدقيق، حدث الـ outbox. أي خطأ بيخرج من الـ callback فيتلغي كل اللي اتكتب (بما فيه كشوف DRAFT اللي الأقفال أنشأها).
 */
export async function repairCommissionPeriod(
  scope: CommissionPeriodRepairScope,
  command: CommissionPeriodRepairCommand,
  ids: IdGenerator,
  clock: Clock,
): Promise<CommissionPeriodRepairResult> {
  const { period, plan } = command.input;
  const validation = validateWireCommissionPlan(plan);
  if (!validation.ok) {
    throw new CommissionPlanVersionError('COMMISSION_PLAN_INVALID', { code: validation.code });
  }
  const calendar = await scope.calendar();
  if (calendar === null) throw new Error('The employee business has no timezone');
  const current = monthOf(clock, calendar.timeZone);
  // لا تصحيح موقوف قبل أول شهر للنشاط ولا في الشهر الحالي أو بعده، ونرفض قبل قفل الموظفة وقبل أي قفل شهور، لأن القفل بينشئ كشفاً لكل شهر في المدى.
  assertCommissionRepairPeriodAllowed({
    period,
    businessStartMonth: sessionBusinessDate(calendar.createdAt, calendar.timeZone).slice(0, 7),
    currentMonth: current,
  });
  if (!(await scope.lockEmployee())) throw new CommissionPlanVersionError('EMPLOYEE_NOT_FOUND');
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
  await postRepairCorrections(scope, command, block, { locked, current });
  return recordRepair(scope, command, stored, block.id);
}

/** الخطوة المشتركة لشهر المصدر بس، وغياب شهر مسودة يتحوّل 409 والمعاملة كلها بتتلغي (spec 059 FR-015، ملاحظة 55-2c). */
async function postRepairCorrections(
  scope: CommissionPeriodRepairScope,
  command: CommissionPeriodRepairCommand,
  block: CommissionRepairOpenBlock,
  {
    locked,
    current,
  }: { locked: Parameters<typeof selectCommissionCorrectionTargets>[0]; current: string },
): Promise<void> {
  const { period } = command.input;
  try {
    await postCommissionCorrections({
      scope: scope.corrections(),
      businessId: command.businessId,
      companyId: command.companyId,
      eventId: block.firstEventId,
      targets: selectCommissionCorrectionTargets(locked, [period], current),
      employees: [{ period, employeeId: command.employeeId }],
    });
  } catch (error) {
    if (error instanceof CommissionPeriodClosedError) {
      throw new CommissionPlanVersionError('COMMISSION_PERIOD_CLOSED');
    }
    throw error;
  }
}

async function recordRepair(
  scope: CommissionPeriodRepairScope,
  command: CommissionPeriodRepairCommand,
  stored: CommissionRepairVersion,
  blockId: string,
): Promise<CommissionPeriodRepairResult> {
  const state = await scope.readBlock(blockId);
  await scope.audit(stored, state);
  const event: CommissionPeriodRepairSaved = {
    business_id: command.businessId,
    employee_id: command.employeeId,
    period: command.input.period,
    version_id: stored.id,
    blocked_correction_id: state.id,
    resolved: state.resolved,
  };
  await scope.outbox.append({
    aggregateType: 'commission_plan_version',
    aggregateId: stored.id,
    eventType: 'CommissionPeriodRepairSaved',
    payload: event,
  });
  return { version: stored, blocked_correction: state };
}
