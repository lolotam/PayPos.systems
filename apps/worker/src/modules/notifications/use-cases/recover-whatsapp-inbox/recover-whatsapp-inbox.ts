import type {
  WhatsappInboxRepository,
  WhatsappInboundQueue,
} from '../../ports/whatsapp-inbox.repository.ts';
import type { Clock } from '../../ports/clock.port.ts';

/** يغلق نافذة سقوط العملية بين commit وتسليم UUID للطابور. */
export class RecoverWhatsappInbox {
  constructor(
    private readonly inbox: WhatsappInboxRepository,
    private readonly queue: WhatsappInboundQueue,
    private readonly clock: Clock,
  ) {}
  async execute(): Promise<void> {
    for (const id of await this.inbox.unfinished()) {
      await this.queue.enqueue(id);
      await this.inbox.confirmEnqueue(id, this.clock.now());
    }
  }
}
