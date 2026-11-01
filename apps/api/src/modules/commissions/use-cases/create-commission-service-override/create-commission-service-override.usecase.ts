import type { CommissionServiceOverride } from '@pospay/contracts';
import { localDate } from '@pospay/i18n';

import type { Clock } from '../../../../shared/ports/clock.port.ts';
import type { IdGenerator } from '../../../../shared/ports/id-generator.port.ts';
import { CommissionPlanVersionError } from '../../domain/errors.ts';
import { assertCommissionPlanEffectiveFrom } from '../../domain/plan-periods.ts';
import type {
  CommissionServiceOverrideScope,
  CommissionServiceOverrideTransactions,
  CreateCommissionServiceOverrideCommand,
} from '../../ports/commission-service-override-transactions.port.ts';
import { lockThroughDecision } from '../lock-through-decision.ts';

export { CommissionPlanVersionError };

/** ينشئ تجاوز عمولة لخدمة تحت أقفال الموظفة والشهور، مع التدقيق وإعادة الإرسال الذرية. */
export class CreateCommissionServiceOverrideUseCase {
  constructor(
    private readonly transactions: CommissionServiceOverrideTransactions,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  execute(command: CreateCommissionServiceOverrideCommand): Promise<CommissionServiceOverride> {
    return this.transactions.run(command, (scope) =>
      writeCommissionServiceOverride(scope, command, this.ids, this.clock),
    );
  }
}

/** الخطوات الداخلية المشتركة بين مسار HTTP واختبارات كاتب التجاوز. */
export async function writeCommissionServiceOverride(
  scope: CommissionServiceOverrideScope,
  command: CreateCommissionServiceOverrideCommand,
  ids: IdGenerator,
  clock: Clock,
): Promise<CommissionServiceOverride> {
  if (!(await scope.lockEmployee())) {
    throw new CommissionPlanVersionError('EMPLOYEE_NOT_FOUND');
  }
  // الخدمة لازم تكون في النشاط نفسه: تجاوز خدمة من نشاط تاني معناه رفض مش قفل.
  if (!(await scope.serviceExists())) {
    throw new CommissionPlanVersionError('SERVICE_NOT_FOUND');
  }
  const calendar = await scope.calendar();
  if (calendar === null) throw new Error('The employee business has no timezone');
  const { locked, decidedAt } = await lockThroughDecision(
    scope,
    { effectiveFrom: command.input.effective_from, wholePeriod: false },
    calendar,
    clock,
  );
  // التجاوز مالوش month كامل، فقواعده هي قواعد الإصدار العادي: الشهر المغلق يرفض، وREVIEWED يرجع DRAFT.
  const reopen = assertCommissionPlanEffectiveFrom({
    effectiveFrom: command.input.effective_from,
    wholePeriod: false,
    today: localDate(decidedAt, calendar.timeZone),
    locked,
  });
  await scope.reopenReviewed(reopen);
  const accessFailure = await scope.recheckAccess();
  if (accessFailure !== null) {
    throw new CommissionPlanVersionError(accessFailure);
  }
  const stored = await scope.insert({
    id: ids.newId(),
    employee_id: command.employeeId,
    service_id: command.input.service_id,
    rule: command.input.rule,
    effective_from: command.input.effective_from,
    created_at: decidedAt.toISOString(),
    created_by: command.userId,
  });
  await scope.audit(stored);
  return stored;
}
