import type { CommissionPlanVersion } from '@pospay/contracts';
import { validateCommissionPlan } from '@pospay/commissions-engine';
import { localDate } from '@pospay/i18n';

import type { Clock } from '../../../../shared/ports/clock.port.ts';
import type { IdGenerator } from '../../../../shared/ports/id-generator.port.ts';
import { toEngineCommissionPlan } from '../../domain/plan-codec.ts';
import { CommissionPlanVersionError } from '../../domain/errors.ts';
import {
  assertCommissionPlanEffectiveFrom,
  commissionPlanMonthsToLock,
  nextCommissionPlanVersion,
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
  const timeZone = await scope.timeZone();
  if (timeZone === null) throw new Error('The employee business has no timezone');
  const now = clock.now();
  const today = localDate(now, timeZone);
  const periods = commissionPlanMonthsToLock(command.input.effective_from, today);
  const locked = await scope.lockPeriods(periods);
  const reopen = assertCommissionPlanEffectiveFrom({
    effectiveFrom: command.input.effective_from,
    wholePeriod: command.input.whole_period,
    today,
    locked,
  });
  await scope.reopenReviewed(reopen);
  if ((await scope.recheckAccess()) !== null) {
    throw new CommissionPlanVersionError('FORBIDDEN');
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
    created_at: now.toISOString(),
    created_by: command.userId,
  });
  await scope.audit(stored);
  return stored;
}
