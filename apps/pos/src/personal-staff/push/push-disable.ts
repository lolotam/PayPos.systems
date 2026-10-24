import { attendanceInstallationId } from '../model/installation-id';
import { unsubscribePush } from './push-browser';
import { pushCalls, withTimeout } from './push-calls';
import { pushRecordStore } from './push-record-idb';

const REVOKE_TIMEOUT_MS = 5000;

/**
 * بتوقّف إشعارات الموبايل: بترفع اشتراك المتصفح، وبتمسح السجل المحلي، وبتراجع السطر عند الـ API.
 * السجل المحلي بيتمسح في كل الأحوال؛ فشل الشبكة مش بيسيب نص سجل (ADR-0052 §7).
 *
 * @param installationId معرف التثبيت، أو null لو التخزين متعطل فمفيش حاجة تتراجع
 */
export async function disablePush(installationId: string | null): Promise<void> {
  try {
    await unsubscribePush();
  } catch {
    // المتصفح رفض يرد: السجل المحلي لسه بينمسح عشان التوكن ما يفضلش على الجهاز.
  }
  try {
    await pushRecordStore.remove();
  } catch {
    // التخزين متعطل: مفيش سجل ينمسح أصلاً.
  }
  if (installationId === null) return;
  try {
    await withTimeout(pushCalls.revoke(installationId), REVOKE_TIMEOUT_MS);
  } catch {
    // المراجعة على السيرفر أفضل effort: الزر يبقى مقفول والسجل اتمسح.
  }
}

/**
 * تنظيف الإشعارات وقت تسجيل الخروج الصريح: نفس الـ disable، بس مبسوط وما بيمنعش الخروج أبداً.
 */
export async function disablePushOnSignOut(): Promise<void> {
  let installationId: string | null = null;
  try {
    installationId = attendanceInstallationId();
  } catch {
    // من غير معرف تثبيت مفيش مراجعة عند الـ API، بس السجل المحلي بينمسح.
  }
  await disablePush(installationId);
}
