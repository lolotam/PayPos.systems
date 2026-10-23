import { isValidSubscriptionKeys } from '@pospay/notifications';

import type { PushKeys } from '../ports/push-keys.port.ts';

/**
 * @returns adapter مفاتيح الدفع، والدالة البحتة نفسها في packages/notifications
 */
export function createPushKeys(): PushKeys {
  return {
    validSubscriptionKeys: (p256dh, auth) => isValidSubscriptionKeys(p256dh, auth),
  };
}
