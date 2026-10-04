import type { CancelLeaveInput } from '@pospay/contracts';
import { cancelPendingLeave } from '../../domain/leave-policy.ts';
import { LeaveError } from '../../domain/leave-types.ts';
import type {
  LeaveActor,
  LeaveClock,
  LeaveTransactions,
} from '../../ports/leave-transactions.port.ts';
/** يلغي النسخة المعلقة لصاحب الطلب أو المدير في نطاقه دون أي قرار اعتماد. */
export class CancelLeaveUseCase {
  constructor(
    private readonly transactions: LeaveTransactions,
    private readonly clock: LeaveClock,
  ) {}
  execute(actor: LeaveActor, input: CancelLeaveInput) {
    return this.transactions.run(actor, 'cancel', async (scope) => {
      if (!scope.before) throw new LeaveError('NOT_FOUND');
      const after = cancelPendingLeave(
        scope.before,
        actor.userId,
        actor.own,
        input.expected_revision,
        this.clock.now(),
      );
      await scope.save(after);
      return after;
    });
  }
}
