import type { CommissionPlanVersion } from '@pospay/contracts';
import { validateCommissionPlan } from '@pospay/commissions-engine';
import { localDate } from '@pospay/i18n';

import type { Clock } from '../../../../shared/ports/clock.port.ts';
import type { IdGenerator } from '../../../../shared/ports/id-generator.port.ts';
import { toEngineCommissionPlan } from '../../domain/plan-codec.ts';
import { CommissionPlanVersionError } from '../../domain/errors.ts';
import {
  assertCommissionPlanDateBeforeLocks,
  assertCommissionPlanEffectiveFrom,
  commissionPlanMonthsStillToLock,
  commissionPlanMonthsToLock,
  nextCommissionPlanVersion,
  type CommissionPlanStatementPeriod,
} from '../../domain/plan-periods.ts';
import type {
  CommissionPlanVersionScope,
  CommissionPlanVersionTransactions,
  CreateCommissionPlanVersionCommand,
} from '../../ports/commission-plan-version-transactions.port.ts';

export { CommissionPlanVersionError };

/** ينشئ إصدار خطة جديداً تحت أقفال الموظفة والشهور، مع التدقيق وإعادة الإرسال الذرية. */
export class CreateCommissionPlanVersionUseCase {
  constructor(
    private readonly transactions: CommissionPlanVersionTransactions,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  execute(command: CreateCommissionPlanVersionCommand): Promise<CommissionPlanVersion> {
    return this.transactions.run(command, (scope) =>
      writeCommissionPlanVersion(scope, command, this.ids, this.clock),
    );
  }
}

async function lockThroughDecision(
  scope: CommissionPlanVersionScope,
  command: CreateCommissionPlanVersionCommand,
  calendar: { readonly timeZone: string; readonly createdAt: Date },
  clock: Clock,
): Promise<{ locked: CommissionPlanStatementPeriod[]; decidedAt: Date }> {
  const today = localDate(clock.now(), calendar.timeZone);
  assertCommissionPlanDateBeforeLocks({
    effectiveFrom: command.input.effective_from,
    wholePeriod: command.input.whole_period,
    today,
    businessStartMonth: localDate(calendar.createdAt, calendar.timeZone).slice(0, 7),
  });
  const locked = await scope.lockPeriods(
    commissionPlanMonthsToLock(command.input.effective_from, today),
  );
  let decidedAt = clock.now();
  while (true) {
    const missing = commissionPlanMonthsStillToLock(
      command.input.effective_from,
      localDate(decidedAt, calendar.timeZone),
      locked.map(({ period }) => period),
    );
    if (missing.length === 0) return { locked, decidedAt };
    locked.push(...(await scope.lockPeriods(missing)));
    decidedAt = clock.now();
  }
}

/** الخطوات الداخلية المشتركة بين مسار HTTP واختبار ترتيب قفل الشهور. */
export async function writeCommissionPlanVersion(
  scope: CommissionPlanVersionScope,
  command: CreateCommissionPlanVersionCommand,
  ids: IdGenerator,
  clock: Clock,
): Promise<CommissionPlanVersion> {
  const validation = validateCommissionPlan(toEngineCommissionPlan(command.input));
  if (!validation.ok) {
    throw new CommissionPlanVersionError('COMMISSION_PLAN_INVALID', { code: validation.code });
  }
  if (!(await scope.lockEmployee())) {
    throw new CommissionPlanVersionError('EMPLOYEE_NOT_FOUND');
  }
  const calendar = await scope.calendar();
  if (calendar === null) throw new Error('The employee business has no timezone');
  const { locked, decidedAt } = await lockThroughDecision(scope, command, calendar, clock);
  const reopen = assertCommissionPlanEffectiveFrom({
    effectiveFrom: command.input.effective_from,
    wholePeriod: command.input.whole_period,
    today: localDate(decidedAt, calendar.timeZone),
    locked,
  });
  await scope.reopenReviewed(reopen);
  const accessFailure = await scope.recheckAccess();
  if (accessFailure !== null) {
    throw new CommissionPlanVersionError(accessFailure);
  }
  const version = nextCommissionPlanVersion(await scope.latestVersion());
  const stored = await scope.insert({
    id: ids.newId(),
    employee_id: command.employeeId,
    version,
    effective_from: command.input.effective_from,
    whole_period: command.input.whole_period,
    repair_period: null,
    base: command.input.base,
    tiers: command.input.tiers,
    package_sale: command.input.package_sale,
    created_at: decidedAt.toISOString(),
    created_by: command.userId,
  });
  await scope.audit(stored);
  return stored;
}
