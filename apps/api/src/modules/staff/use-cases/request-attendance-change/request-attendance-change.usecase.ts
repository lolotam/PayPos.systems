import type { AttendanceChangeRequestInput } from '@pospay/contracts';
import {
  AttendanceChangeError,
  planChangeRequest,
} from '../../domain/attendance-change-request.ts';
import type { AttendanceChangeKinds } from '../../ports/attendance-change-kinds.port.ts';
import type {
  AttendanceChangeActor,
  AttendanceChangeClock,
  AttendanceChangeTransactions,
} from '../../ports/attendance-change-transactions.port.ts';
export { AttendanceChangeError } from '../../domain/attendance-change-request.ts';

/** يسجل الطلب بعد فحص السلطة ويطبق طلب المالك فوراً في المعاملة نفسها. */
export class RequestAttendanceChangeUseCase {
  constructor(
    private readonly transactions: AttendanceChangeTransactions,
    private readonly clock: AttendanceChangeClock,
    private readonly kinds: AttendanceChangeKinds,
  ) {}
  async execute(actor: AttendanceChangeActor, input: AttendanceChangeRequestInput) {
    if (actor.device) throw new AttendanceChangeError('FORBIDDEN');
    const kind = this.kinds.find(input.kind);
    if (!kind) throw new AttendanceChangeError('ATTENDANCE_CHANGE_KIND_UNAVAILABLE');
    return this.transactions.file(actor, input, kind, this.clock, async (scope) => {
      const plan = planChangeRequest(input, { ...scope, userId: actor.userId });
      const checked = await kind.check(scope);
      const values = plan.status === 'APPROVED' ? await kind.apply(scope, checked) : checked;
      return scope.save(plan, values);
    });
  }
}
