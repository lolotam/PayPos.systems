import type { Locale } from '@pospay/i18n';

import {
  base64UrlToBytes,
  currentSubscription,
  notificationPermission,
  pushSubscriptionBody,
  requestNotificationPermission,
  subscribePush,
  unsubscribePush,
  type PushSubscriptionLike,
} from './push-browser';
import { PushKeyStaleError, pushCalls } from './push-calls';
import { notifyPushRecordChanged } from './push-record-events';
import { pushRecordStore } from './push-record-idb';

/** نتيجة محاولة التشغيل: اتشغّل، ولا المتصفح رفض، ولا الخدمة مش جاهزة، ولا في خطأ. */
export type PushEnableOutcome =
  | { kind: 'enabled'; token: string }
  | { kind: 'blocked' }
  | { kind: 'not-ready' }
  | { kind: 'failed' };

export interface PushEnableInput {
  companyId: string;
  locale: Locale;
  installationId: string;
}

async function subscribeWithConfig(config: {
  vapid_public_key: string;
}): Promise<PushSubscriptionLike> {
  // المتصفح بيقبل اشتراك واحد بس على الـ service worker، فالتسجيل الجديد بيحل محل القديم
  // عشان الشركة اللي آخر مرة هي اللي تستلم (WP-Q4).
  const existing = await currentSubscription();
  if (existing !== null) await unsubscribePush();
  return subscribePush(base64UrlToBytes(config.vapid_public_key));
}

/**
 * بتشغّل إشعارات الموبايل من ضغطة المستخدم: الإذن، ثم اشتراك جديد، ثم تسجيل عند الـ API.
 *
 * @param input الشركة واللغة ومعرف التثبيت
 * @returns نتيجة المحاولة
 */
export async function enablePush(input: PushEnableInput): Promise<PushEnableOutcome> {
  const permission = notificationPermission();
  if (permission === 'denied') return { kind: 'blocked' };
  if (permission === 'default') {
    const asked = await requestNotificationPermission();
    if (asked !== 'granted') return { kind: 'blocked' };
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const config = await pushCalls.config();
    if (config.kind === 'not-ready') return { kind: 'not-ready' };
    const subscription = await subscribeWithConfig(config.config);
    const token = crypto.randomUUID();
    try {
      await pushCalls.register({
        installation_id: input.installationId,
        vapid_key_id: config.config.vapid_key_id,
        delivery_token: token,
        subscription: pushSubscriptionBody(subscription),
        locale: input.locale,
      });
    } catch (cause) {
      // سجل ناقص أسوأ من مفيش سجل: الاشتراك الجديد بيتشال لو التسجيل مرفوض.
      await unsubscribePush();
      if (cause instanceof PushKeyStaleError && attempt === 0) continue;
      return { kind: 'failed' };
    }
    await pushRecordStore.write({
      token,
      subscriber_ref: config.config.subscriber_ref,
      company_id: input.companyId,
      vapid_key_id: config.config.vapid_key_id,
      suspended: false,
    });
    notifyPushRecordChanged();
    return { kind: 'enabled', token };
  }
  return { kind: 'failed' };
}
