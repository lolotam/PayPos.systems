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
 * السجل المحلي بيتمسح في كل الأحوال؛ فشل الشبكة مش بيسيب نص سجل (ADR-0052 §7).
 *
 * @param installationId معرف التثبيت، أو null لو التخزين متعطل فمفيش حاجة تتراجع
 */
export async function disablePush(installationId: string | null): Promise<void> {
  await runPushExclusive(async () => {
    // إيقاف الإشعارات بيكسر الجيل: أي تسجيل شغال في تبويب تاني بيمسك نفسه (ADR-0052 §7).
    await withTimeout(pushRecordStore.bumpGeneration(), GENERATION_TIMEOUT_MS).catch(
      () => undefined,
    );
    try {
      await pushRecordStore.remove();
    } catch {
      // التخزين متعطل: مفيش سجل ينمسح أصلاً.
    }
    notifyPushRecordChanged();
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
  await withTimeout(pushRecordStore.bumpGeneration(), GENERATION_TIMEOUT_MS).catch(() => undefined);
  await withTimeout(pushRecordStore.remove(), SIGN_OUT_RECORD_TIMEOUT_MS).catch(() => undefined);
  notifyPushRecordChanged();
  await disablePush(installationId);
}
