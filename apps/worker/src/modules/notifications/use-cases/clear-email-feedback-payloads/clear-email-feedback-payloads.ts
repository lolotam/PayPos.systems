import { inboxPayloadCutoff } from '../../domain/inbox-retention.ts';
import type { Clock } from '../../ports/clock.port.ts';
import type { EmailFeedbackInboxRepository } from '../../ports/email-feedback.port.ts';

/** ينهي احتفاظ JSON دون المساس بالمنع والبصمات والتدقيق. */
export class ClearEmailFeedbackPayloads {
  constructor(
    private readonly inbox: EmailFeedbackInboxRepository,
    private readonly clock: Clock,
  ) {}

  execute(): Promise<number> {
    return this.inbox.clearPayloads(inboxPayloadCutoff(this.clock.now()));
  }
}
