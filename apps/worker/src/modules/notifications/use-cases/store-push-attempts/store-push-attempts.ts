import { pushAttemptDecision, type PushAttemptInput } from '../../domain/push-attempt.ts';
import type { PushAttemptsRepository } from '../../ports/push-attempts.repository.ts';
import type { Clock } from '../../ports/clock.port.ts';
import type { IdGenerator } from '../../ports/id-generator.port.ts';

/** طلب تسجيل محاولة دفع: المستخدم والمصدر والقالب الآمن والموعد، من غير اشتراك محدد. */
export type StorePushAttemptsRequest = Omit<PushAttemptInput, 'subscription'>;

/** يسجّل محاولة دفع لكل اشتراك حيّ للمستخدم؛ منتهية الموعد بتتسجل منتهية من غير إذن إرسال. */
export class StorePushAttempts {
  constructor(
    readonly repository: PushAttemptsRepository,
    readonly clock: Clock,
    readonly ids: IdGenerator,
  ) {}

  async execute(request: StorePushAttemptsRequest): Promise<number> {
    const now = this.clock.now();
    const decision = pushAttemptDecision(request.deadline, now);
    const subscriptions = await this.repository.liveSubscriptions(request.userId);
    let created = 0;
    for (const subscription of subscriptions) {
      const inserted = await this.repository.insert(
        { ...request, subscription },
        decision,
        this.ids.newId(),
        this.ids.newId(),
        now,
      );
      if (inserted) created += 1;
    }
    return created;
  }
}
