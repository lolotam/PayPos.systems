import type { InAppInput } from '../../domain/in-app-notification.ts';
import type { InAppRepository } from '../../ports/in-app.repository.ts';
import type { Clock } from '../../ports/clock.port.ts';
import type { IdGenerator } from '../../ports/id-generator.port.ts';

/** يحفظ الإشعار الشخصي مرة واحدة بدون قناة إرسال خارج الداتابيز. */
export class StoreInAppNotification {
  constructor(
    readonly repository: InAppRepository,
    readonly clock: Clock,
    readonly ids: IdGenerator,
  ) {}

  execute(input: InAppInput): Promise<boolean> {
    return this.repository.insert(input, this.ids.newId(), this.ids.newId(), this.clock.now());
  }
}
