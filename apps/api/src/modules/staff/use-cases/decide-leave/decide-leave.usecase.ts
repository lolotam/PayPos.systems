import type { DecideLeaveInput } from '@pospay/contracts';
import { decidePendingLeave } from '../../domain/leave-decision.ts';
import { LeaveError } from '../../domain/leave-types.ts';
import type {
  LeaveActor,
  LeaveClock,
  LeaveTransactions,
} from '../../ports/leave-transactions.port.ts';

/** يقرر نسخة معلقة تحت قفل الموظف والطلب ثم يحفظ التدقيق والحدث معها. */
export class DecideLeaveUseCase {
  constructor(
    private readonly transactions: LeaveTransactions,
    private readonly clock: LeaveClock,
  ) {}
  execute(actor: LeaveActor, input: DecideLeaveInput) {
    return this.transactions.run(actor, 'decide', this.clock, async (scope) => {
      if (!scope.before) throw new LeaveError('NOT_FOUND');
      const others = input.decision === 'APPROVED' ? await scope.overlaps(scope.before) : [];
      const record = decidePendingLeave(
        scope.before,
        scope.employee.user_id,
        actor.userId,
        input,
        scope.now,
        others,
      );
      await scope.save(record);
      return record;
    });
  }
}
