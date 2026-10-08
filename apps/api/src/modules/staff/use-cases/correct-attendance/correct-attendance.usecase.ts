import type { CorrectAttendanceInput, CorrectAttendanceResult } from '@pospay/contracts';
import { planAttendanceCorrection } from '../../domain/attendance-correction.ts';
import type {
  AttendanceCorrectionActor,
  AttendanceCorrectionClock,
  AttendanceCorrectionTransactions,
} from '../../ports/attendance-correction-transactions.port.ts';

export { AttendanceCorrectionError } from '../../domain/attendance-correction.ts';

/** يصحح دخول و/أو خروج جلسة مغلقة تحت قفل حالة الموظف ويحفظ التدقيق في المعاملة نفسها. */
export class CorrectAttendanceUseCase {
  constructor(
    private readonly transactions: AttendanceCorrectionTransactions,
    private readonly clock: AttendanceCorrectionClock,
  ) {}
  execute(
    actor: AttendanceCorrectionActor,
    input: CorrectAttendanceInput,
  ): Promise<CorrectAttendanceResult> {
    return this.transactions.run(actor, this.clock, async (scope) => {
      const plan = planAttendanceCorrection(scope.session, input, {
        now: scope.now,
        neighbours: scope.neighbours,
        actorIsEmployee: scope.employeeUserId === actor.userId,
        actorIsOwner: scope.owner,
      });
      return scope.save(plan);
    });
  }
}
