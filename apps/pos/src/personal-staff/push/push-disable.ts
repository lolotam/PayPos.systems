import { attendanceInstallationId } from '../model/installation-id';
import { unsubscribePush } from './push-browser';
import { pushCalls, withTimeout } from './push-calls';
import { runPushExclusive } from './push-lock';
import { notifyPushRecordChanged } from './push-record-events';
import { pushRecordStore } from './push-record-idb';

const REVOKE_TIMEOUT_MS = 5000;
const SIGN_OUT_TIMEOUT_MS = 5000;

/**
 * بتوقّف إشعارات الموبايل: بتمسح السجل المحلي الأول، وبترفع اشتراك المتصفح، وبتراجع السطر عند الـ API.
 * السجل المحلي بيتمسح في كل الأحوال؛ فشل الشبكة مش بيسيب نص سجل (ADR-0052 §7).
 *
 * @param installationId معرف التثبيت، أو null لو التخزين متعطل فمفيش حاجة تتراجع
 */
export async function disablePush(installationId: string | null): Promise<void> {
  await runPushExclusive(async () => {
    const record = await pushRecordStore.read().catch(() => null);
    if (record !== null) {
      try {
        await pushRecordStore.remove();
      } catch {
        // التخزين متعطل: مفيش سجل ينمسح أصلاً.
      }
      notifyPushRecordChanged();
    }
    try {
      await unsubscribePush();
    } catch {
      // المتصفح رفض يرد: السجل المحلي اتمسح خلاص.
    }
    if (installationId === null) return;
    try {
      await withTimeout(pushCalls.revoke(installationId), REVOKE_TIMEOUT_MS);
    } catch {
      // المراجعة على السيرفر أفضل effort: الزر يبقى مقفول والسجل اتمسح.
    }
  });
}

/**
 * تنظيف الإشعارات وقت تسجيل الخروج الصريح: بيتبلع أي فشل ومحدش بيقف، ومهلة قصيرة
 * عشان المتصفح المعلّق ما بيأخرش الخروج (ADR-0052 §7).
 */
export async function disablePushOnSignOut(): Promise<void> {
  let installationId: string | null = null;
  try {
    installationId = attendanceInstallationId();
  } catch {
    // من غير معرف تثبيت مفيش مراجعة عند الـ API، بس السجل المحلي بينمسح.
  }
  try {
    await withTimeout(disablePush(installationId), SIGN_OUT_TIMEOUT_MS);
  } catch {
    // الخروج الصريح ما بيقفش أبداً، حتى لو المتصفح اتعلّق.
  }
}
