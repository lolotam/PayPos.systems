import type { InboxActor, InAppRepository } from '../../ports/in-app.repository.ts';
import type { Clock } from '../../ports/clock.port.ts';

/** يقرّ صندوق المستخدم بالشركة الحالية، مع الحفاظ على الإقرارات السابقة. */
export class MarkAllNotificationsRead {
  constructor(
    readonly repository: InAppRepository,
    readonly clock: Clock,
  ) {}
  async execute(actor: InboxActor): Promise<{ ok: true }> {
    await this.repository.markAllRead(actor, this.clock.now());
    return { ok: true };
  }
}
