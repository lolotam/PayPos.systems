import type { RevokeLeaveInput } from '@pospay/contracts';
import { revokeApprovedLeave } from '../../domain/leave-decision.ts';
import { LeaveError } from '../../domain/leave-types.ts';
import type {
  LeaveActor,
  LeaveClock,
  LeaveTransactions,
} from '../../ports/leave-transactions.port.ts';

/** يسحب موافقة مسموحة قبل البداية ولا يعيد الطلب لحالة معلقة. */
export class RevokeLeaveUseCase {
  constructor(
    private readonly transactions: LeaveTransactions,
    private readonly clock: LeaveClock,
  ) {}
  execute(actor: LeaveActor, input: RevokeLeaveInput) {
    return this.transactions.run(actor, 'revoke', this.clock, async (scope) => {
      if (!scope.before) throw new LeaveError('NOT_FOUND');
      const record = revokeApprovedLeave(
        scope.before,
        scope.employee.user_id,
        actor.userId,
        input,
        scope.now,
      );
      await scope.save(record);
      return record;
    });
  }
}
