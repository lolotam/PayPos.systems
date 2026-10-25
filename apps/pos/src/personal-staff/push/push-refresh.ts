import type { PushConfig } from '@pospay/contracts';
import type { Locale } from '@pospay/i18n';

import {
  base64UrlToBytes,
  currentSubscription,
  notificationPermission,
  pushSubscriptionBody,
  subscribeWithDeadline,
  unsubscribePush,
  type PushSubscriptionLike,
} from './push-browser';
import { pushCalls, withAbortTimeout } from './push-calls';
import { hasCrossTabLock, runPushExclusive } from './push-lock';
import { notifyPushRecordChanged } from './push-record-events';
import { pushRecordStore } from './push-record-idb';
import type { PushRecord } from './push-record';
import { fetchSessionConfig, sessionStillMatches } from './push-session-binding';

const API_TIMEOUT_MS = 10_000;
const SUBSCRIBE_TIMEOUT_MS = 15_000;
const REVOKE_TIMEOUT_MS = 5000;

/** نتيجة التحديث: ولا حاجة، أو تحديث، أو تدوير، أو مسح، أو جلسة اتغيرت فمنعت التسجيل. */
export type PushRefreshOutcome =
  | { kind: 'none' }
  | { kind: 'refreshed' }
  | { kind: 'rotated'; token: string }
  | { kind: 'cleared' }
  | { kind: 'session-changed' };

export interface PushRefreshInput {
  companyId: string;
  locale: Locale;
  config: PushConfig;
  installationId: string | null;
}

/**
 * بتحدّث الاشتراك وقت فتح التطبيق وبتصلّح تدوير مفتاح VAPID.
 * بتشتغل بس في جلسة الشركة اللي السجل بيقول عليها؛ في أي شركة تانية مفيش أي طلب (FR-019).
 *
 * @param input الشركة واللغة ومفتاح VAPID الحالي ومعرف التثبيت
 * @returns نتيجة التحديث
 */
export async function refreshPush(input: PushRefreshInput): Promise<PushRefreshOutcome> {
  // من غير قفل بين التبويبات، تحديثين متوازيين بيركبوا على اشتراك واحد وسطر واحد على
  // السيرفر. بنرفض قبل أي قراءة أو تسجيل (ADR-0052 §7).
  if (!hasCrossTabLock()) return { kind: 'none' };
  return runPushExclusive(async (): Promise<PushRefreshOutcome> => {
    const generation = await pushRecordStore.generation();
    let record: PushRecord | null;
    try {
      record = await pushRecordStore.read();
    } catch {
      // السجل مش معروف: من غير ما نمسح ولا نسجل، مفيش حاجة نعملها.
      return { kind: 'none' };
    }
    if (record === null) return { kind: 'none' };
    if (record.company_id !== input.companyId) return { kind: 'none' };
    const fresh = await fetchSessionConfig();
    if (fresh === null) return { kind: 'none' };
    if (fresh.subscriber_ref !== input.config.subscriber_ref) {
      return { kind: 'session-changed' };
    }
    const current: PushRefreshInput = { ...input, config: fresh };
    return refreshWithConfig(current, record, generation);
  });
}

async function refreshWithConfig(
  input: PushRefreshInput,
  record: PushRecord,
  generation: number,
): Promise<PushRefreshOutcome> {
  // مرجع تاني جواب مؤكد إن الجهاز بقى لحد تاني، فبنشيل الاشتراك والسجل
  // من غير أي PUT (ADR-0052 §7).
  if (input.config.subscriber_ref !== record.subscriber_ref) {
    await unsubscribePush().catch(() => undefined);
    await removeRecord();
    return { kind: 'cleared' };
  }
  const live = record.suspended ? await resume(record, generation) : record;
  if (live === null) return { kind: 'none' };
  if (notificationPermission() !== 'granted') return { kind: 'none' };
  if (input.installationId === null) return { kind: 'none' };
  const installationId: string = input.installationId;
  if (input.config.vapid_key_id !== live.vapid_key_id) {
    return rotate(input, live, installationId, generation);
  }
  const subscription = await currentSubscription();
  if (subscription === null) {
    await removeRecord();
    await revoke(installationId);
    return { kind: 'cleared' };
  }
  return refreshPlain(input, live, installationId, subscription);
}

async function refreshPlain(
  input: PushRefreshInput,
  record: PushRecord,
  installationId: string,
  subscription: PushSubscriptionLike,
): Promise<PushRefreshOutcome> {
  if (!(await sessionStillMatches(input.config.subscriber_ref))) {
    return { kind: 'session-changed' };
  }
  await withAbortTimeout(
    (signal) =>
      pushCalls.register(
        {
          installation_id: installationId,
          vapid_key_id: input.config.vapid_key_id,
          delivery_token: record.token,
          subscription: pushSubscriptionBody(subscription),
          locale: input.locale,
        },
        signal,
      ),
    API_TIMEOUT_MS,
  );
  return { kind: 'refreshed' };
}

/**
 * سجل معلّق بعد فحص توقيع فاشل: نفس مرجع المشترك بيرجّعه قايم (ADR-0052 §7).
 *
 * @param record السجل المعلّق
 * @param generation جيل السجل وقت ما الشغل بدأ
 * @returns السجل بعد الرجوع، أو null لما الجيل أو المراجعة أو التوكن يتغير
 */
async function resume(record: PushRecord, generation: number): Promise<PushRecord | null> {
  const live = { ...record, suspended: false };
  try {
    const written = await pushRecordStore.writeIfGeneration(live, generation, {
      clearSuspension: true,
      expectRevision: record.revision,
      expectToken: record.token,
    });
    if (!written) return null;
  } catch {
    return null;
  }
  notifyPushRecordChanged();
  return live;
}

async function rotate(
  input: PushRefreshInput,
  record: PushRecord,
  installationId: string,
  generation: number,
): Promise<PushRefreshOutcome> {
  // المتصفح ما بيقولش المفتاح اللي اتعمل بيه الاشتراك، فالتسجيل القديم بيتشال والتسجيل
  // الجديد بيتعمل بالمفتاح الجديد — وده مش متعلق بالسطر عند الـ API (ADR-0052 §2).
  const existing = await currentSubscription();
  if (existing !== null) await unsubscribePush();
  const subscription = await subscribeWithDeadline(
    base64UrlToBytes(input.config.vapid_public_key),
    SUBSCRIBE_TIMEOUT_MS,
  );
  if (subscription === null) {
    await removeRecord();
    return { kind: 'cleared' };
  }
  const token = crypto.randomUUID();
  if (!(await sessionStillMatches(input.config.subscriber_ref))) {
    await dropSubscription();
    return { kind: 'session-changed' };
  }
  try {
    await registerRotated(input, subscription, installationId, token);
  } catch {
    await dropSubscription();
    await removeRecord();
    return { kind: 'cleared' };
  }
  const outcome = await writeRotatedRecord(record, input, token, generation);
  if (outcome === 'failed') {
    // حالة المخزن مجهولة: السجل بيفضل بمفتاحه القديم، والتحديث الجاي يدور تاني.
    return { kind: 'none' };
  }
  if (outcome === 'stale') {
    // جيل أو مراجعة أو توكن أحدث: السجل بقى بتاع حد تاني (خروج أو تعليق دخول أو إيقاف)،
    // فبنسيبه ونشيل بس تسجيلنا (ADR-0052 §7).
    await abortRotation(installationId);
    return { kind: 'cleared' };
  }
  notifyPushRecordChanged();
  return { kind: 'rotated', token };
}

/** تسجيل الاشتراك الجديد عند الـ API بالمفتاح الجديد. */
async function registerRotated(
  input: PushRefreshInput,
  subscription: PushSubscriptionLike,
  installationId: string,
  token: string,
): Promise<void> {
  await withAbortTimeout(
    (signal) =>
      pushCalls.register(
        {
          installation_id: installationId,
          vapid_key_id: input.config.vapid_key_id,
          delivery_token: token,
          subscription: pushSubscriptionBody(subscription),
          locale: input.locale,
        },
        signal,
      ),
    API_TIMEOUT_MS,
  );
}

/** نتيجة كتابة سجل التدوير: اتكتب، أو اتغير الجيل، أو فشل. */
type RotationWrite = 'written' | 'stale' | 'failed';

/** كتابة السجل الجديد بعد التدوير؛ النتيجة بتقول السجل اتكتب، ولا الجيل اتغير، ولا الكتابة فشلت. */
async function writeRotatedRecord(
  record: PushRecord,
  input: PushRefreshInput,
  token: string,
  generation: number,
): Promise<RotationWrite> {
  try {
    const written = await pushRecordStore.writeIfGeneration(
      {
        token,
        subscriber_ref: record.subscriber_ref,
        company_id: record.company_id,
        vapid_key_id: input.config.vapid_key_id,
        suspended: false,
        revision: record.revision,
      },
      generation,
      { expectRevision: record.revision, expectToken: record.token },
    );
    return written ? 'written' : 'stale';
  } catch {
    return 'failed';
  }
}

/** التدوير اتوقف: الاشتراك بيتشال والسطر عند الـ API بيراجع. */
async function abortRotation(installationId: string): Promise<void> {
  await dropSubscription();
  await revoke(installationId);
}

/** الاشتراك الجديد بيتشال: المتصفح مينفعش يفضل مسجل من غير حد يطلبه. */
async function dropSubscription(): Promise<void> {
  await unsubscribePush().catch(() => undefined);
}

async function removeRecord(): Promise<void> {
  await pushRecordStore.remove().catch(() => undefined);
  notifyPushRecordChanged();
}

async function revoke(installationId: string): Promise<void> {
  try {
    await withAbortTimeout((signal) => pushCalls.revoke(installationId, signal), REVOKE_TIMEOUT_MS);
  } catch {
    // المراجعة على السيرفر أفضل effort: السجل المحلي اتمسح والزر بيعرض مقفول.
  }
}
