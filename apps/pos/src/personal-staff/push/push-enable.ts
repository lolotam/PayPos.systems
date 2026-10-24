import type { PushConfig, PushSubscriptionInput } from '@pospay/contracts';
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
import { PushKeyStaleError, pushCalls, withTimeout } from './push-calls';
import { currentPushGeneration, runPushExclusive } from './push-lock';
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
  try {
    return await withTimeout(
      subscribePush(base64UrlToBytes(config.vapid_public_key)),
      SUBSCRIBE_TIMEOUT_MS,
    );
  } catch {
    await unsubscribePush().catch(() => undefined);
    return null;
  }
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
    const generation = currentPushGeneration();
    // القراءة من جوه القفل: لو شغل تاني غيّر السجل، إحنا بنشوف النسخة الجديدة.
    const previous = await pushRecordStore.read().catch(() => null);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const config = await withTimeout(pushCalls.config(), API_TIMEOUT_MS);
      if (config.kind === 'not-ready') return { kind: 'not-ready' };
      const subscription = await subscribeWithConfig(config.config, previous);
      if (subscription === null) return { kind: 'failed' };
      const token = crypto.randomUUID();
      try {
        await withTimeout(
          pushCalls.register(registerBody(input, config.config, subscription, token)),
          API_TIMEOUT_MS,
        );
      } catch (cause) {
        // سجل ناقص أسوأ من مفيش سجل: الاشتراك الجديد بيتشال لو التسجيل مرفوض.
        await unsubscribePush().catch(() => undefined);
        if (cause instanceof PushKeyStaleError && attempt === 0) continue;
        return { kind: 'failed' };
      }
      // الخروج أو جيل تاني كسر الشغل ده: السجل ما يتكتبش، والتوكن الجديد بيتشال.
      if (generation !== currentPushGeneration()) {
        await unsubscribePush().catch(() => undefined);
        return { kind: 'failed' };
      }
      // السجل بيتكتب بعد ما الـ API يقبل، والزر يعرف التوكن الجديد قبل ما يتغيّر السجل.
      input.onRegistered(token);
      try {
        await pushRecordStore.write({
          token,
          subscriber_ref: config.config.subscriber_ref,
          company_id: input.companyId,
          vapid_key_id: config.config.vapid_key_id,
          suspended: false,
        });
      } catch {
        // السيرفر ماسك توكن من غير سجل محلي: من غيره الـ service worker مش هيلاقيه أبداً.
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
    await withTimeout(pushCalls.revoke(installationId), REVOKE_TIMEOUT_MS);
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
