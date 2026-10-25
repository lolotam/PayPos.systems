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
import { dropSubscription, removeRecord, resumeRecord, revoke } from './push-refresh-record';
import { checkBeforeMutation, suspendChangedSession } from './push-refresh-session';
import { checkSession, fetchSessionConfig, identityOf } from './push-session-binding';

const API_TIMEOUT_MS = 10_000;
const SUBSCRIBE_TIMEOUT_MS = 15_000;

/** نتيجة التحديث: ولا حاجة، أو تحديث، أو تدوير، أو مسح، أو جلسة اتغيرت فمنعت التسجيل. */
export type PushRefreshOutcome =
  | { kind: 'none' }
  | { kind: 'refreshed' }
  | { kind: 'rotated'; token: string; vapid_key_id: string }
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
 * قبل أي تسجيل بتتأكد إن الجلسة لسه لنفس الشخص ونفس الشركة (ADR-0052 §7): شخص تاني
 * بيعلّق السجل، ونفس الشخص في شركة تانية مفيش معاه أي تغيير (FR-018).
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
    const record = await readStoredRecord();
    if (record === null) return { kind: 'none' };
    // قراءة غير مؤكدة: من غير هوية الجلسة ما فيش تسجيل ولا تغيير (ADR-0052 §7).
    const fresh = await fetchSessionConfig();
    if (fresh === null) return { kind: 'none' };
    // القرار على صاحب السجل المخزن مش على إعدادات اللي نادى (ممكن تكون قديمة): سجل شخص
    // تاني بيتعلّق في نفس الخطوة عشان نصه ما يوصلش للجلسة دي (ADR-0052 §7).
    if (fresh.subscriber_ref !== record.subscriber_ref) {
      // سجل معلّق أصلاً مش محتاج كتابة تانية: الواجهة بس تقرا الجلسة الجديدة.
      if (record.suspended) return { kind: 'session-changed' };
      return suspendChangedSession(fresh.subscriber_ref);
    }
    // نفس الشخص في شركة تانية: مفيش تغيير (FR-018، FR-019، WP-Q4). الفحص ده بعد فحص الشخص
    // عشان النتيجة ماتعتمدش على توقيت الكاش، والتحديث دايمًا بإعدادات الجلسة الحالية.
    if (record.company_id !== fresh.company_id || record.company_id !== input.companyId) {
      return { kind: 'none' };
    }
    return refreshWithConfig({ ...input, config: fresh }, record, generation);
  });
}

/**
 * بيقرأ السجل المحلي زي ما هو، لأن القرار بيتبني على صاحبه (الشخص ثم الشركة) مش على
 * الشركة اللي الشاشة مفتوحة فيها.
 *
 * @returns السجل المخزن، أو null لما مفيش سجل أو القراءة فشلت
 */
async function readStoredRecord(): Promise<PushRecord | null> {
  try {
    return await pushRecordStore.read();
  } catch {
    // السجل مش معروف: من غير ما نمسح ولا نسجل، مفيش حاجة نعملها.
    return null;
  }
}

async function refreshWithConfig(
  input: PushRefreshInput,
  record: PushRecord,
  generation: number,
): Promise<PushRefreshOutcome> {
  if (record.suspended) {
    const aborted = await checkBeforeMutation(input.config);
    if (aborted !== null) return aborted;
  }
  const live = record.suspended ? await resumeRecord(record, generation) : record;
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
  const session = await checkSession(identityOf(input.config));
  if (session.kind === 'mismatch') return suspendChangedSession(session.current.subscriber_ref);
  if (session.kind !== 'match') return { kind: 'none' };
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
 * التدوير: تبديل اشتراك المتصفح بالمفتاح الجديد وتسجيله عند الـ API (ADR-0052 §7).
 */
async function rotate(
  input: PushRefreshInput,
  record: PushRecord,
  installationId: string,
  generation: number,
): Promise<PushRefreshOutcome> {
  // قبل تبديل اشتراك المتصفح: تغيير هنا بيمسح اشتراك المتصفح من غير ما حد يطلبه.
  const blocked = await checkBeforeMutation(input.config);
  if (blocked !== null) return blocked;
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
  const session = await checkSession(identityOf(input.config));
  if (session.kind === 'mismatch') {
    // التعليق قبل الإلغاء: طول ما الإلغاء معلّق، السجل القديم بيفضل مفتوح ونص صاحبه
    // يقدر يظهر (ADR-0052 §7).
    const aborted = await suspendChangedSession(session.current.subscriber_ref);
    await dropSubscription();
    return aborted;
  }
  if (session.kind !== 'match') {
    // القراءة المجروفة أو شركة تانية: بنشيل الاشتراك اللي اتعمل دلوقتي بس ومفيش PUT،
    // والتحديث الجاي يدور تاني.
    await dropSubscription();
    return { kind: 'none' };
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
  return { kind: 'rotated', token, vapid_key_id: input.config.vapid_key_id };
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
