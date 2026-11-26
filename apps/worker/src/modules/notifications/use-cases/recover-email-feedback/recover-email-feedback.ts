import type { Clock } from '../../ports/clock.port.ts';
import type {
  EmailFeedbackInboxRepository,
  EmailFeedbackQueue,
} from '../../ports/email-feedback.port.ts';

/** يسترد الصفوف اللي ما اتسلمتش للطابور، والصفوف المفتوحة اللي موعد المحاولة الجاية لها جه. */
export class RecoverEmailFeedback {
  constructor(
    private readonly inbox: EmailFeedbackInboxRepository,
    private readonly queue: EmailFeedbackQueue,
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<void> {
    for (const id of await this.inbox.unconfirmed()) {
      await this.queue.enqueue(id);
      await this.inbox.confirmEnqueue(id, this.clock.now());
    }
    for (const id of await this.inbox.due(this.clock.now())) {
      await this.queue.enqueue(id);
    }
  }
}
