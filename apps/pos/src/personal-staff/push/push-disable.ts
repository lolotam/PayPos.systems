import { attendanceInstallationId } from '../model/installation-id';
import { unsubscribePush } from './push-browser';
import { pushCalls, withAbortTimeout, withTimeout } from './push-calls';
import { runPushExclusive } from './push-lock';
import { notifyPushRecordChanged } from './push-record-events';
import { pushRecordStore } from './push-record-idb';

const REVOKE_TIMEOUT_MS = 5000;
const SIGN_OUT_TIMEOUT_MS = 5000;
const SIGN_OUT_RECORD_TIMEOUT_MS = 2000;
const GENERATION_TIMEOUT_MS = 2000;

/**
 * بتوقّف إشعارات الموبايل: بتمسح السجل المحلي، وبترفع اشتراك المتصفح، وبتراجع السطر عند الـ API.
 * السجل اللي بدأ بيه الإيقاف بيتمسح حتى لو الشبكة فشلت؛ أما سجل أحدث لموظفة تانية فبيفضل
 * بتوكنه واشتراكه وسطره على السيرفر (ADR-0052 §7).
 * الضغطة تحمل لقطة السجل اللي المعروض: لو السجل اتغيّر قبل ما القفل يتاخد، ما نعملش
 * حاجة خالص — ولا مسح ولا اشتراك ولا مراجعة.
 *
 * @param installationId معرف التثبيت، أو null لو التخزين متعطل فمفيش حاجة تتراجع
 * @param expected لقطة السجل المعروض وقت الضغطة: لو السجل اتغيّر، ما نعملش حاجة خالص
 */
export async function disablePush(
  installationId: string | null,
  expected: { token: string | null; revision: number } | null = null,
): Promise<void> {
  await runPushExclusive(async () => {
    if (expected !== null) {
      const current = await pushRecordStore.read().catch(() => null);
      const changed =
        current !== null &&
        (current.token !== expected.token || current.revision !== expected.revision);
      if (changed) {
        // السجل بقى بتاع حد تاني: الضغطة كانت على لقطة قديمة، فمفيش مسح ولا تراجع.
        notifyPushRecordChanged();
        return;
      }
    }
    // إيقاف الإشعارات بيكسر الجيل: أي تسجيل شغال في تبويب تاني بيمسك نفسه (ADR-0052 §7).
    await withTimeout(pushRecordStore.bumpGeneration(), GENERATION_TIMEOUT_MS).catch(
      () => undefined,
    );
    const stored = await pushRecordStore.read().catch(() => null);
    const newer =
      expected !== null &&
      stored !== null &&
      (stored.token !== expected.token || stored.revision !== expected.revision);
    let removed = true;
    try {
      if (expected !== null) {
        removed = await pushRecordStore.removeIfMatches(expected);
      } else {
        await pushRecordStore.remove();
      }
    } catch {
      // التخزين متعطل: مفيش سجل ينمسح أصلاً.
    }
    notifyPushRecordChanged();
    // المطابقة والمسح في transaction واحد: سجل موظفة تانية ما يتمسحش ولا يتراجع سطره.
    if (newer || (!removed && stored !== null)) return;
    try {
      await unsubscribePush();
    } catch {
      // المتصفح رفض يرد: السجل المحلي اتمسح خلاص.
    }
    if (installationId === null) return;
    try {
      await withAbortTimeout(
        (signal) => pushCalls.revoke(installationId, signal),
        REVOKE_TIMEOUT_MS,
      );
    } catch {
      // المراجعة على السيرفر أفضل effort: الزر يبقى مقفول والسجل اتمسح.
    }
  });
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
  await disablePush(installationId, expected);
}
