import type { CancelAttendanceChangeInput } from '@pospay/contracts';
import { AttendanceChangeError, planChangeCancel } from '../../domain/attendance-change-request.ts';
import type {
  AttendanceChangeActor,
  AttendanceChangeClock,
  AttendanceChangeTransactions,
} from '../../ports/attendance-change-transactions.port.ts';

/** يسحب صاحب الطلب نسخته المعلقة بلا إشعار أو أثر على الحضور. */
export class CancelAttendanceChangeUseCase {
  constructor(
    private readonly transactions: AttendanceChangeTransactions,
    private readonly clock: AttendanceChangeClock,
  ) {}
  execute(actor: AttendanceChangeActor, input: CancelAttendanceChangeInput) {
    return this.transactions.cancel(actor, this.clock, async (scope) => {
      if (!scope.before) throw new AttendanceChangeError('NOT_FOUND');
      const plan = planChangeCancel(scope.before, {
        ...scope,
        userId: actor.userId,
        revision: input.revision,
      });
      return scope.save(plan, scope.before);
    });
  }
}
