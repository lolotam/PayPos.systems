import type { RequestLeaveInput } from '@pospay/contracts';
import { materializeLeave, validateLeaveOverlap } from '../../domain/leave-period.ts';
import { validateLeaveEmployee } from '../../domain/leave-policy.ts';
import type {
  LeaveActor,
  LeaveClock,
  LeaveIds,
  LeaveTransactions,
} from '../../ports/leave-transactions.port.ts';
export { LeaveError } from '../../domain/leave-types.ts';
/** يثبت أهلية الموظف والفترة قبل حفظ الطلب والتدقيق والحدث معاً. */
export class RequestLeaveUseCase {
  constructor(
    private readonly transactions: LeaveTransactions,
    private readonly ids: LeaveIds,
    private readonly clock: LeaveClock,
  ) {}
  execute(actor: LeaveActor, input: RequestLeaveInput) {
    return this.transactions.run(actor, 'create', this.clock, async (scope) => {
      const now = scope.now;
      const period = materializeLeave(input, scope.timezone, now, actor.own);
      validateLeaveEmployee(scope.employee, scope.branchId, period);
      validateLeaveOverlap(period, await scope.overlaps(period));
      const record = {
        ...period,
        id: this.ids.newId(),
        employee_id: scope.employee.id,
        business_id: actor.businessId,
        branch_id: scope.branchId,
        status: 'PENDING' as const,
        requested_by: actor.userId,
        requested_at: now.toISOString(),
        cancelled_by: null,
        cancelled_at: null,
        decided_by: null,
        decided_at: null,
        rejection_reason: null,
        revision: 1,
      };
      await scope.save(record);
      return record;
    });
  }
}
