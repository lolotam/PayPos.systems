import type { InboxActor, InAppRepository } from '../../ports/in-app.repository.ts';
import type { Clock } from '../../ports/clock.port.ts';

/** يقرّ إشعار المستخدم مرة واحدة دون كشف وجود إشعار لشخص آخر. */
export class MarkNotificationRead {
  constructor(
    readonly repository: InAppRepository,
    readonly clock: Clock,
  ) {}
  async execute(actor: InboxActor, id: string): Promise<{ ok: true }> {
    await this.repository.markRead(actor, id, this.clock.now());
    return { ok: true };
  }
}
