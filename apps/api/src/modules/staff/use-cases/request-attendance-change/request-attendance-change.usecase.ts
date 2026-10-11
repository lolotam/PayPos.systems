import type { AttendanceChangeRequestInput } from '@pospay/contracts';
import {
  AttendanceChangeError,
  planChangeRequest,
} from '../../domain/attendance-change-request.ts';
import type { IdGenerator } from '../../../../shared/ports/id-generator.port.ts';
import type { AttendanceChangeKinds } from '../../ports/attendance-change-kinds.port.ts';
import type {
  AttendanceChangeActor,
  AttendanceChangeClock,
  AttendanceChangeTransactions,
} from '../../ports/attendance-change-transactions.port.ts';
export { AttendanceChangeError } from '../../domain/attendance-change-request.ts';
export { AttendanceChangeKindRefusal } from '../../ports/attendance-change-kinds.port.ts';

/** يسجل الطلب بعد فحص السلطة؛ طلب المالك يُحفظ PENDING أولاً ثم يُطبق ويُعتمد في المعاملة نفسها. */
export class RequestAttendanceChangeUseCase {
  constructor(
    private readonly transactions: AttendanceChangeTransactions,
    private readonly clock: AttendanceChangeClock,
    private readonly kinds: AttendanceChangeKinds,
    private readonly ids: IdGenerator,
  ) {}
  async execute(actor: AttendanceChangeActor, input: AttendanceChangeRequestInput) {
    const kind = this.kinds.find(input.kind);
    if (!kind) throw new AttendanceChangeError('ATTENDANCE_CHANGE_KIND_UNAVAILABLE');
    const requestId = this.ids.newId();
    return this.transactions.file(actor, input, kind, this.clock, requestId, async (scope) => {
      const plan = planChangeRequest(input, { ...scope, userId: actor.userId });
      const checked = await kind.check(scope);
      if (plan.status !== 'APPROVED') return scope.save(plan, checked);
      const request = await scope.hold(plan, checked);
      return scope.save(plan, await kind.apply({ ...scope, request }, checked));
    });
  }
}
