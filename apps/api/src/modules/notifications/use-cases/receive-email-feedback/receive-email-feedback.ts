import { EmailFeedbackQueueUnavailableError } from '@pospay/notifications';
import type { Clock } from '../../ports/clock.port.ts';
import type {
  EmailFeedbackEvent,
  EmailFeedbackInboxRepository,
  EmailFeedbackQueue,
} from '../../ports/email-feedback.repository.ts';

/** يستقبل حدث رد المزود: يحفظه منقّحاً، ثم يسلّم job واحد بالـ id، ويأكّد التسليم. */
export class ReceiveEmailFeedback {
  constructor(
    private readonly inbox: EmailFeedbackInboxRepository,
    private readonly queue: EmailFeedbackQueue,
    private readonly clock: Clock,
  ) {}

  async execute(event: EmailFeedbackEvent): Promise<void> {
    const stored = await this.inbox.accept(event, this.clock.now());
    // إعادة التسليم بتتأكد بـ 200 من غير تغيير: الصف موجود، والـ sweep بيكمّل لو هو لسه unconfirmed.
    if (!stored.inserted) return;
    try {
      await this.queue.enqueue(stored.id);
    } catch (error) {
      // الصف دائم في القاعدة، فالتسليم الفاشل مش بيلغي الحدث؛ الـ sweep بيلاقيه تاني.
      if (error instanceof EmailFeedbackQueueUnavailableError) return;
      throw error;
    }
    await this.inbox.confirmEnqueue(stored.id, this.clock.now());
  }
}
