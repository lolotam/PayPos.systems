import type { PushConfig } from '@pospay/contracts';
import type { PushApiConfiguration } from '@pospay/notifications';

// شاشة مفتاح الإشعارات في تطبيق الموظف: المفتاح العام ومعرّفه ومرجع المشترك الخاص بالمتصل.
export function pushConfigFor(
  config: PushApiConfiguration | null,
  userId: string,
  subscriberRef: (userId: string) => string,
): PushConfig | null {
  if (config === null) return null;
  return {
    vapid_public_key: config.publicKey,
    vapid_key_id: config.keyId,
    subscriber_ref: subscriberRef(userId),
  };
}
