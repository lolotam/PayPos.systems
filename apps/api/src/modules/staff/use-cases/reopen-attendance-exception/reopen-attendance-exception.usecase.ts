import type { AttendanceExceptionDecisionInput } from '@pospay/contracts';
import { reopenAttendanceException } from '../../domain/attendance-exception.ts';
import type {
  AttendanceExceptionActor,
  AttendanceExceptionClock,
  AttendanceExceptionTransactions,
} from '../../ports/attendance-exception-transactions.port.ts';

/** يعيد فتح استثناء مغلق تحت قفل صفه ويبقي السبب السابق في التدقيق فقط. */
export class ReopenAttendanceExceptionUseCase {
  constructor(
    private readonly transactions: AttendanceExceptionTransactions,
    private readonly clock: AttendanceExceptionClock,
  ) {}
  execute(actor: AttendanceExceptionActor, input: AttendanceExceptionDecisionInput) {
    return this.transactions.run(actor, 'reopen', this.clock, async (scope) => {
      const change = reopenAttendanceException(
        scope.before,
        scope.employeeUserId,
        actor.userId,
        input,
        scope.now,
      );
      await scope.save(change);
      return change.record;
    });
  }
}
