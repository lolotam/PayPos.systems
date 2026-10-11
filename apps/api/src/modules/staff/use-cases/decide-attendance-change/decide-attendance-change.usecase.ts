import type {
  DecideAttendanceChangeInput,
  AttendanceChangeDecisionResult,
} from '@pospay/contracts';
import {
  AttendanceChangeError,
  planChangeDecision,
} from '../../domain/attendance-change-request.ts';
import type { AttendanceChangeKinds } from '../../ports/attendance-change-kinds.port.ts';
import type {
  AttendanceChangeActor,
  AttendanceChangeClock,
  AttendanceChangeTransactions,
} from '../../ports/attendance-change-transactions.port.ts';

/** يقرر حامل الصلاحية الطلب بعد منع القرار الذاتي لغير المالك ويعيد فحص النوع؛ أي رفض يعيد المعاملة كلها. */
export class DecideAttendanceChangeUseCase {
  constructor(
    private readonly transactions: AttendanceChangeTransactions,
    private readonly clock: AttendanceChangeClock,
    private readonly kinds: AttendanceChangeKinds,
  ) {}
  async execute(
    actor: AttendanceChangeActor,
    input: DecideAttendanceChangeInput,
  ): Promise<AttendanceChangeDecisionResult> {
    const record = await this.transactions.decide(actor, this.clock, async (scope) => {
      const request = scope.before;
      if (!request) throw new AttendanceChangeError('NOT_FOUND');
      const plan = planChangeDecision(request, input, { ...scope, userId: actor.userId });
      if (plan.status === 'REJECTED') return { ...(await scope.save(plan, request)), effect: null };
      const kind = this.kinds.find(request.kind);
      if (!kind) throw new AttendanceChangeError('ATTENDANCE_CHANGE_KIND_UNAVAILABLE');
      const checked = await kind.check(scope);
      const values = await kind.apply({ ...scope, request }, checked);
      return { ...(await scope.save(plan, values)), effect: values.effect ?? null };
    });
    return record as AttendanceChangeDecisionResult;
  }
}
