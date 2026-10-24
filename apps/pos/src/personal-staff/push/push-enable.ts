import type { PushConfig, PushSubscriptionInput } from '@pospay/contracts';
import type { Locale } from '@pospay/i18n';

import {
  base64UrlToBytes,
  currentSubscription,
  notificationPermission,
  pushSubscriptionBody,
  requestNotificationPermission,
  subscribeWithDeadline,
  unsubscribePush,
  type PushSubscriptionLike,
} from './push-browser';
import { PushKeyStaleError, pushCalls, withAbortTimeout } from './push-calls';
import { runPushExclusive } from './push-lock';
import { notifyPushRecordChanged } from './push-record-events';
import { pushRecordStore } from './push-record-idb';
import type { PushRecord } from './push-record';

const API_TIMEOUT_MS = 10_000;
const SUBSCRIBE_TIMEOUT_MS = 15_000;
const REVOKE_TIMEOUT_MS = 5000;

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
  onRegistered(token: string): void;
}

async function subscribeWithConfig(
  config: { vapid_public_key: string },
  previous: PushRecord | null,
): Promise<PushSubscriptionLike | null> {
  // المتصفح بيقبل اشتراك واحد بس على الـ service worker، فالتسجيل الجديد بيحل محل القديم
  // عشان الشركة اللي آخر مرة هي اللي تستلم (WP-Q4).
  const existing = await currentSubscription();
  if (existing !== null || previous !== null) await unsubscribePush();
  const subscription = await subscribeWithDeadline(
    base64UrlToBytes(config.vapid_public_key),
    SUBSCRIBE_TIMEOUT_MS,
  );
  if (subscription === null) await unsubscribePush().catch(() => undefined);
  return subscription;
}

/**
 * بتشغّل إشعارات الموبايل من ضغطة المستخدم: الإذن، ثم اشتراك جديد، ثم تسجيل عند الـ API.
 *
 * @param input الشركة واللغة ومعرف التثبيت ودالة التسجيل
 * @returns نتيجة المحاولة
 */
export async function enablePush(input: PushEnableInput): Promise<PushEnableOutcome> {
  // طلب الإذن لازم يكون أول خطوة في ضغطة المستخدم: المتصفح بيقبل الطلب بس طول ما كان
  // في تفاعل حي، والقفل أو أي قراءة بتستنى وبتضيّع التفاعل (ADR-0052 §7).
  const permission = notificationPermission();
  if (permission === 'denied') return { kind: 'blocked' };
  if (permission === 'default') {
    const asked = await requestNotificationPermission();
    if (asked !== 'granted') return { kind: 'blocked' };
  }
  return runPushExclusive(async (): Promise<PushEnableOutcome> => {
    // الجيل بيتقرا من IndexedDB عشان كل التبويبات تشوف نفس الرقم (ADR-0052 §7).
    const generation = await pushRecordStore.generation();
    const previous = await pushRecordStore.read().catch(() => null);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const config = await withAbortTimeout((signal) => pushCalls.config(signal), API_TIMEOUT_MS);
      if (config.kind === 'not-ready') return { kind: 'not-ready' };
      const subscription = await subscribeWithConfig(config.config, previous);
      if (subscription === null) return { kind: 'failed' };
      const token = crypto.randomUUID();
      try {
        await withAbortTimeout(
          (signal) =>
            pushCalls.register(registerBody(input, config.config, subscription, token), signal),
          API_TIMEOUT_MS,
        );
      } catch (cause) {
        // سجل ناقص أسوأ من مفيش سجل: الاشتراك الجديد بيتشال لو التسجيل مرفوض.
        await unsubscribePush().catch(() => undefined);
        if (cause instanceof PushKeyStaleError && attempt === 0) continue;
        return { kind: 'failed' };
      }
      // السجل بيتكتب بعد ما الـ API يقبل، والزر يعرف التوكن الجديد قبل ما يتغيّر السجل.
      input.onRegistered(token);
      let written = false;
      try {
        written = await pushRecordStore.writeIfGeneration(
          {
            token,
            subscriber_ref: config.config.subscriber_ref,
            company_id: input.companyId,
            vapid_key_id: config.config.vapid_key_id,
            suspended: false,
          },
          generation,
        );
      } catch {
        written = false;
      }
      if (!written) {
        // جيل تاني غيّر السجل: التوكين الجديد بيتشال والسطر عند الـ API بيراجع.
        await unsubscribePush().catch(() => undefined);
        await revoke(input.installationId);
        return { kind: 'failed' };
      }
      notifyPushRecordChanged();
      return { kind: 'enabled', token };
    }
    return { kind: 'failed' };
  });
}

async function revoke(installationId: string): Promise<void> {
  try {
    await withAbortTimeout((signal) => pushCalls.revoke(installationId, signal), REVOKE_TIMEOUT_MS);
  } catch {
    // المراجعة على السيرفر أفضل effort: السجل مش هيتكتب، فالتوكن مش هيلاقي حد.
  }
}

/** جسم التسجيل: المعرف والمفتاح والتوكن واللغة والاشتراك (ADR-0052 §4). */
function registerBody(
  input: PushEnableInput,
  config: PushConfig,
  subscription: PushSubscriptionLike,
  token: string,
): PushSubscriptionInput {
  return {
    installation_id: input.installationId,
    vapid_key_id: config.vapid_key_id,
    delivery_token: token,
    subscription: pushSubscriptionBody(subscription),
    locale: input.locale,
  };
}
