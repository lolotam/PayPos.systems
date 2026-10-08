import type { AttendanceExceptionDecisionInput } from '@pospay/contracts';
import { resolveAttendanceException } from '../../domain/attendance-exception.ts';
import type {
  AttendanceExceptionActor,
  AttendanceExceptionClock,
  AttendanceExceptionTransactions,
} from '../../ports/attendance-exception-transactions.port.ts';

export { AttendanceExceptionError } from '../../domain/attendance-exception.ts';

/** يغلق استثناء حضور مفتوحاً تحت قفل صفه ويحفظ التدقيق في المعاملة نفسها. */
export class ResolveAttendanceExceptionUseCase {
  constructor(
    private readonly transactions: AttendanceExceptionTransactions,
    private readonly clock: AttendanceExceptionClock,
  ) {}
  execute(actor: AttendanceExceptionActor, input: AttendanceExceptionDecisionInput) {
    return this.transactions.run(actor, 'resolve', this.clock, async (scope) => {
      const change = resolveAttendanceException(
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
