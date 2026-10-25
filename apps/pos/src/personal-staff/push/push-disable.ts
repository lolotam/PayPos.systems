import { attendanceInstallationId } from '../model/installation-id';
import { unsubscribePush } from './push-browser';
import { pushCalls, withAbortTimeout, withTimeout } from './push-calls';
import { runPushExclusive } from './push-lock';
import { notifyPushRecordChanged } from './push-record-events';
import { pushRecordStore } from './push-record-idb';
import type { PushRecord } from './push-record';

const REVOKE_TIMEOUT_MS = 5000;
const SIGN_OUT_TIMEOUT_MS = 5000;
const SIGN_OUT_RECORD_TIMEOUT_MS = 2000;
const GENERATION_TIMEOUT_MS = 2000;

/** نتيجة الإيقاف: اتنفذ، ولا سجل أحدث اتساب زي ما هو، ولا حالة المخزن مجهولة فمفيش حاجة اتلمست. */
export type DisableOutcome = 'disabled' | 'unchanged' | 'failed';

/**
 * بتوقّف إشعارات الموبايل: بتمسح السجل المحلي، وبترفع اشتراك المتصفح، وبتراجع السطر عند الـ API.
 * السجل اللي بدأ بيه الإيقاف بيتمسح حتى لو الشبكة فشلت؛ أما سجل أحدث لموظفة تانية فبيفضل
 * بتوكنه واشتراكه وسطره على السيرفر (ADR-0052 §7).
 * الضغطة تحمل لقطة السجل اللي المعروض: لو السجل اتغيّر قبل ما القفل يتاخد، ما نعملش
 * حاجة خالص — ولا مسح ولا اشتراك ولا مراجعة.
 * في وضع 'abort' (ضغطة الموظفة) أي حالة مخزن مجهولة معناها 'failed' ومفيش خطوة مدمرة؛
 * في وضع 'proceed' (تنظيف تسجيل الخروج) الخطأ بيتبلع عشان التنضيف لازم يحصل للشخص الجاي.
 *
 * @param installationId معرف التثبيت، أو null لو التخزين متعطل فمفيش حاجة تتراجع
 * @param expected لقطة السجل المعروض وقت الضغطة: لو السجل اتغيّر، ما نعملش حاجة خالص
 * @param options سلوكنا مع حالة المخزن المجهولة: 'abort' للضغطة، 'proceed' لتنظيف الخروج
 * @returns نتيجة الإيقاف: اتنفذ، ولا اتساب كما هو، ولا حالة المخزن مجهولة
 */
export async function disablePush(
  installationId: string | null,
  expected: { token: string | null; revision: number } | null = null,
  options: { onUnknown: 'abort' | 'proceed' } = { onUnknown: 'abort' },
): Promise<DisableOutcome> {
  const abort = options.onUnknown === 'abort';
  return runPushExclusive(async (): Promise<DisableOutcome> => {
    if (expected !== null) {
      const guard = await guardSnapshot(expected, abort);
      if (guard !== null) return guard;
    }
    const bump = await bumpGenerationSafely(abort);
    if (bump !== null) return bump;
    let stored: PushRecord | null;
    try {
      stored = await pushRecordStore.read();
    } catch {
      if (abort) return 'failed';
      stored = null;
    }
    const newer =
      expected !== null &&
      stored !== null &&
      (stored.token !== expected.token || stored.revision !== expected.revision);
    let removed = !abort;
    try {
      if (expected !== null) {
        removed = await pushRecordStore.removeIfMatches(expected);
      } else {
        await pushRecordStore.remove();
        removed = true;
      }
    } catch {
      if (abort) return 'failed';
      // التخزين متعطل: مفيش سجل ينمسح أصلاً.
    }
    notifyPushRecordChanged();
    // المطابقة والمسح في transaction واحد: سجل موظفة تانية ما يتمسحش ولا يتراجع سطره.
    if (newer || (!removed && stored !== null)) return 'unchanged';
    await teardownSubscription(installationId);
    return 'disabled';
  });
}

/** الحارس: هل اللقطة اللي المعروض لسه هي السجل المخزن؟ */
async function guardSnapshot(
  expected: { token: string | null; revision: number },
  abort: boolean,
): Promise<DisableOutcome | null> {
  let current: PushRecord | null;
  try {
    current = await pushRecordStore.read();
  } catch {
    if (abort) return 'failed';
    current = null;
  }
  if (current === null) return null;
  if (current.token === expected.token && current.revision === expected.revision) return null;
  // السجل بقى بتاع حد تاني: الضغطة كانت على لقطة قديمة، فمفيش مسح ولا تراجع.
  notifyPushRecordChanged();
  return 'unchanged';
}

/** كسر جيل السجل: في وضع الإيقاف فشله معناه إن حالة المخزن مجهولة. */
async function bumpGenerationSafely(abort: boolean): Promise<DisableOutcome | null> {
  if (!abort) {
    await withTimeout(pushRecordStore.bumpGeneration(), GENERATION_TIMEOUT_MS).catch(
      () => undefined,
    );
    return null;
  }
  const bumped = await withTimeout(pushRecordStore.bumpGeneration(), GENERATION_TIMEOUT_MS).then(
    () => true,
    () => false,
  );
  return bumped ? null : 'failed';
}

/** تفكيك الاشتراك ومراجعة السطر على السيرفر: أوضح خطوة بعد ما السجل اتمسح. */
async function teardownSubscription(installationId: string | null): Promise<void> {
  try {
    await unsubscribePush();
  } catch {
    // المتصفح رفض يرد: السجل المحلي اتمسح خلاص.
  }
  if (installationId === null) return;
  try {
    await withAbortTimeout((signal) => pushCalls.revoke(installationId, signal), REVOKE_TIMEOUT_MS);
  } catch {
    // المراجعة على السيرفر أفضل effort: الزر يبقى مقفول والسجل اتمسح.
  }
}

/**
 * تنظيف الإشعارات وقت تسجيل الخروج الصريح: بيكسر جيل السجل ويمسح التوكن من غير ما يستنى
 * القفل، وبعدين بيعمل الإيقاف الكامل. الخروج ما بيقفش أبداً (ADR-0052 §7).
 */
export async function disablePushOnSignOut(): Promise<void> {
  let installationId: string | null = null;
  try {
    installationId = attendanceInstallationId();
  } catch {
    // من غير معرف تثبيت مفيش مراجعة عند الـ API، بس السجل المحلي بينمسح.
  }
  try {
    await withTimeout(signOutCleanup(installationId), SIGN_OUT_TIMEOUT_MS);
  } catch {
    // الخروج الصريح ما بيقفش أبداً، حتى لو المتصفح أو التخزين اتعلّق.
  }
}

/** التوكين بينمسح بره القفل: لو شغل تاني ماسك القفل على طلب واقف، الخروج يفضل ماشي. */
async function signOutCleanup(installationId: string | null): Promise<void> {
  const stored = await pushRecordStore.read().catch(() => null);
  const expected = { token: stored?.token ?? null, revision: stored?.revision ?? 0 };
  await withTimeout(pushRecordStore.bumpGeneration(), GENERATION_TIMEOUT_MS).catch(() => undefined);
  await withTimeout(pushRecordStore.remove(), SIGN_OUT_RECORD_TIMEOUT_MS).catch(() => undefined);
  notifyPushRecordChanged();
  // تنظيف الخروج لازم يحصل للشخص الجاي مهما كانت حالة المخزن.
  await disablePush(installationId, expected, { onUnknown: 'proceed' });
}
