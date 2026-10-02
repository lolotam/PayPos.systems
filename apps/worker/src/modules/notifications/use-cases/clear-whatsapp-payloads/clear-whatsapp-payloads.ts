import { inboxPayloadCutoff } from '../../domain/inbox-retention.ts';
import type { WhatsappInboxRepository } from '../../ports/whatsapp-inbox.repository.ts';
import type { Clock } from '../../ports/clock.port.ts';

/** ينهي احتفاظ JSON دون المساس بالمنع والبصمات والتدقيق. */
export class ClearWhatsappPayloads {
  constructor(
    private readonly inbox: WhatsappInboxRepository,
    private readonly clock: Clock,
  ) {}
  execute(): Promise<number> {
    return this.inbox.clearPayloads(inboxPayloadCutoff(this.clock.now()));
  }
}
