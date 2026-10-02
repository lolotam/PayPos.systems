import {
  whatsappMessageBatches,
  type ScrubbedWhatsappMessage,
} from '../../domain/whatsapp-command.ts';
import type { Clock } from '../../ports/clock.port.ts';
import type {
  WhatsappInboundQueue,
  WhatsappInboxRepository,
} from '../../ports/whatsapp-inbox.repository.ts';

/** يثبت أوامر المنع أولاً ثم يؤكد تسليم العمل الثانوي للطابور قبل الرد. */
export class ReceiveWhatsappStop {
  constructor(
    private readonly inbox: WhatsappInboxRepository,
    private readonly queue: WhatsappInboundQueue,
    private readonly clock: Clock,
  ) {}

  async execute(messages: readonly ScrubbedWhatsappMessage[]): Promise<void> {
    const ids: string[] = [];
    for (const batch of whatsappMessageBatches(messages))
      ids.push(...(await this.inbox.accept(batch, this.clock.now())));
    for (const id of new Set(ids)) {
      await this.queue.enqueue(id);
      await this.inbox.confirmEnqueue(id, this.clock.now());
    }
  }
}
