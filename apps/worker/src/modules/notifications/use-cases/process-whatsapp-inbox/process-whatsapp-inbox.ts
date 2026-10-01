import type { WhatsappInboxRepository } from '../../ports/whatsapp-inbox.repository.ts';
import type { Clock } from '../../ports/clock.port.ts';

/** يثبت انتهاء المعالجة الثانوية بدون أي تأثير منع أو إرسال مزود. */
export class ProcessWhatsappInbox {
  constructor(
    private readonly inbox: WhatsappInboxRepository,
    private readonly clock: Clock,
  ) {}
  execute(id: string): Promise<void> {
    return this.inbox.process(id, this.clock.now());
  }
}
