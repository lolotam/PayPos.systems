import { EmailFeedbackQueueUnavailableError } from '../../ports/email-feedback.repository.ts';
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

  async execute(event: EmailFeedbackEvent, deadline: Date): Promise<void> {
    const at = this.clock.now();
    const stored = await this.inbox.accept(event, at, deadline.getTime() - at.getTime());
    // إعادة التسليم بتتأكد بـ 200 من غير تغيير: الصف موجود، والـ sweep بيكمّل لو هو لسه unconfirmed.
    if (!stored.inserted) return;
    // الصف اتعهد، فأي خطوة فاتتها الموعد بتسيبه للاسترداد بدل ما نتجاوز ميزانية الطلب (§6).
    if (this.clock.now().getTime() >= deadline.getTime()) return;
    try {
      await this.queue.enqueue(stored.id, deadline);
    } catch (error) {
      // الصف دائم في القاعدة، فالتسليم الفاشل مش بيلغي الحدث؛ الـ sweep بيلاقيه تاني.
      if (error instanceof EmailFeedbackQueueUnavailableError) return;
      throw error;
    }
    // تأكيد متأخر برضه بيسيب الصف unconfirmed: الاسترداد بيأكد بدل ما نعلّق على الرد.
    if (this.clock.now().getTime() >= deadline.getTime()) return;
    await this.inbox.confirmEnqueue(
      stored.id,
      this.clock.now(),
      deadline.getTime() - this.clock.now().getTime(),
    );
  }
}
