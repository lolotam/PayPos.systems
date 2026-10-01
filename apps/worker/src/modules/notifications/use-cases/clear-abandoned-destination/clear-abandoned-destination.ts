import type { AttemptsRepository, CleanupInput } from '../../ports/attempts.repository.ts';
import type { Clock } from '../../ports/clock.port.ts';
import type { IdGenerator } from '../../ports/id-generator.port.ts';

/** يمسح وجهة التنفيذ المصرّف بعد يوم دون تغيير حالته أو اختلاق نتيجة إرسال. */
export class ClearAbandonedDestination {
  constructor(
    readonly attempts: AttemptsRepository,
    readonly clock: Clock,
    readonly ids: IdGenerator,
  ) {}
  execute(input: CleanupInput): Promise<boolean> {
    return this.attempts.clearAbandoned(input, this.ids.newId(), this.clock.now());
  }
}
