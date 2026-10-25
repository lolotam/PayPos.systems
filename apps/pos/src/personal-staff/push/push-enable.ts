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
import { hasCrossTabLock, runPushExclusive } from './push-lock';
import { notifyPushRecordChanged } from './push-record-events';
import { pushRecordStore } from './push-record-idb';
import type { PushRecord } from './push-record';
import { suspendChangedSession } from './push-refresh-session';
import { checkSession, identityOf } from './push-session-binding';

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

/** لقطة السجل قبل التشغيل: الجيل والسجل اللي بدأ منه ومراجعته. */
interface StartSnapshot {
  generation: number;
  previous: PushRecord | null;
  revision: number;
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
 * لقطة السجل قبل التشغيل: من غير قراءة سليمة مفيش تسجيل يتعمل، والجيل لازم يتقرا مع
 * السجل عشان الكتابة المحروسة تشوف نفس القيم (ADR-0052 §7).
 */
async function readStartSnapshot(): Promise<StartSnapshot | null> {
  const generation = await pushRecordStore.generation();
  try {
    const previous = await pushRecordStore.read();
    return { generation, previous, revision: previous?.revision ?? 0 };
  } catch {
    // التخزين مش شغال: مفيش سجل نكتب عليه ولا نسجل من غيره، فالمحاولة بتتقفل.
    return null;
  }
}

/** نتيجة كتابة سجل التشغيل: اتكتب، ولا السجل اتغيّر قبل الكتابة، ولا المخزن رما استثناء. */
type EnabledWrite = 'written' | 'lost' | 'error';

/**
 * كتابة السجل بعد ما الـ API قبل التسجيل: الكتابة المحروسة هي اللي بتحدد مين كسب
 * السجل، والتوقعات (الجيل والمراجعة والتوكن) بتمنع الكتابة فوق سجل أحدث.
 */
async function writeEnabledRecord(
  input: PushEnableInput,
  config: PushConfig,
  token: string,
  snapshot: StartSnapshot,
): Promise<EnabledWrite> {
  try {
    // التعليق اللي كان موجود قبل التشغيل بيتشال؛ أي تعليق جه مع تسجيل تاني بيتساب.
    const written = await pushRecordStore.writeIfGeneration(
      {
        token,
        subscriber_ref: config.subscriber_ref,
        company_id: input.companyId,
        vapid_key_id: config.vapid_key_id,
        suspended: false,
        revision: snapshot.revision,
      },
      snapshot.generation,
      {
        clearSuspension: snapshot.previous?.suspended === true,
        expectRevision: snapshot.revision,
        expectToken: snapshot.previous?.token ?? null,
      },
    );
    return written ? 'written' : 'lost';
  } catch {
    return 'error';
  }
}

/**
 * بتشغّل إشعارات الموبايل من ضغطة المستخدم: الإذن، ثم اشتراك جديد، ثم تسجيل عند الـ API.
 *
 * @param input الشركة واللغة ومعرف التثبيت ودالة التسجيل
 * @returns نتيجة المحاولة
 */
export async function enablePush(input: PushEnableInput): Promise<PushEnableOutcome> {
  // من غير قفل بين التبويبات، تشغيلين متوازيين بيركبوا على اشتراك واحد وسطر واحد على
  // السيرفر. بنرفض قبل أي إذن أو تسجيل (ADR-0052 §7).
  if (!hasCrossTabLock()) return { kind: 'failed' };
  // طلب الإذن لازم يكون أول خطوة في ضغطة المستخدم: المتصفح بيقبل الطلب بس طول ما كان
  // في تفاعل حي، والقفل أو أي قراءة بتستنى وبتضيّع التفاعل (ADR-0052 §7).
  const permission = notificationPermission();
  if (permission === 'denied') return { kind: 'blocked' };
  if (permission === 'default') {
    const asked = await requestNotificationPermission();
    if (asked !== 'granted') return { kind: 'blocked' };
  }
  return runPushExclusive(async (): Promise<PushEnableOutcome> => {
    // الجيل والمراجعة والتوكن بيتقرا من IndexedDB: التبويبات تشوف نفس القيم، والتوكن
    // بيكشف استبدال عادي مش بيزود المراجعة (ADR-0052 §7).
    const snapshot = await readStartSnapshot();
    if (snapshot === null) return { kind: 'failed' };
    const { previous } = snapshot;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const config = await withAbortTimeout((signal) => pushCalls.config(signal), API_TIMEOUT_MS);
      if (config.kind === 'not-ready') return { kind: 'not-ready' };
      // الإعدادات بتاعة شركة تانية: التسجيل لازم يتم للشركة اللي الشاشة بتقولها، وإلا
      // السطر على السيرفر بيروح في شركة تانية غير اللي الموظفة فتحت شاشة الموظف فيها.
      if (config.config.company_id !== input.companyId) return { kind: 'failed' };
      const subscription = await subscribeWithConfig(config.config, previous);
      if (subscription === null) return { kind: 'failed' };
      const token = crypto.randomUUID();
      try {
        const registered = await confirmAndRegister(input, config.config, subscription, token);
        if (!registered) return { kind: 'failed' };
      } catch (cause) {
        // سجل ناقص أسوأ من مفيش سجل: الاشتراك الجديد بيتشال لو التسجيل مرفوض.
        await unsubscribePush().catch(() => undefined);
        if (cause instanceof PushKeyStaleError && attempt === 0) continue;
        return { kind: 'failed' };
      }
      // السجل بيتكتب بعد ما الـ API يقبل، والزر يعرف التوكن الجديد قبل ما يتغيّر السجل.
      input.onRegistered(token);
      const written = await writeEnabledRecord(input, config.config, token, snapshot);
      if (written === 'lost') {
        // السجل اتغيّر تحتنا (خروج أو تعليق دخول أو إيقاف): التشغيلين متسلسلين بالقفل،
        // فمحدش كسب السجل — تسجيلنا مش مطلوب من حد، فبيتشال وسطره بيراجع.
        await unsubscribePush().catch(() => undefined);
        await revoke(input.installationId);
        return { kind: 'failed' };
      }
      if (written === 'error') {
        // حالة المخزن مجهولة: من غير ما نمسح ولا نراجع، التحديث وقت الفتح أو زر الإيقاف
        // بيراجعوا السجل.
        return { kind: 'failed' };
      }
      notifyPushRecordChanged();
      return { kind: 'enabled', token };
    }
    return { kind: 'failed' };
  });
}

/**
 * التأكيد قبل PUT: السيرفر بيربط التسجيل بشخص الجلسة وشركتها، فالقراءة المجهولة بتوقف
 * من غير ما تبعث حاجة ومش بتمسح الاشتراك الجديد، والاختلاف المؤكد بيعلّق السجل القديم
 * الأول (طول ما الإلغاء معلّق نص صاحبه يقدر يظهر) وبيشيل اشتراك هذا التبويب بس، وهو
 * لسه ما اتسجلش في السيرفر.
 */
async function confirmAndRegister(
  input: PushEnableInput,
  config: PushConfig,
  subscription: PushSubscriptionLike,
  token: string,
): Promise<boolean> {
  const session = await checkSession(identityOf(config));
  if (session === 'unknown') return false;
  if (session === 'mismatch') {
    await suspendChangedSession();
    await unsubscribePush().catch(() => undefined);
    return false;
  }
  await withAbortTimeout(
    (signal) => pushCalls.register(registerBody(input, config, subscription, token), signal),
    API_TIMEOUT_MS,
  );
  return true;
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
