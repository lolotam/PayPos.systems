import { attendanceInstallationId } from '../model/installation-id';
import { unsubscribePush } from './push-browser';
import { pushCalls, withTimeout } from './push-calls';
import { notifyPushRecordChanged } from './push-record-events';
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
  notifyPushRecordChanged();
  if (installationId === null) return;
  try {
    await withTimeout(pushCalls.revoke(installationId), REVOKE_TIMEOUT_MS);
  } catch {
    // المراجعة على السيرفر أفضل effort: الزر يبقى مقفول والسجل اتمسح.
  }
}

/**
 * تنظيف الإشعارات وقت تسجيل الخروج الصريح: بتبلع أي فشل جواه، فتسجيل الخروج ما بيقفش أبداً.
 */
export async function disablePushOnSignOut(): Promise<void> {
  let installationId: string | null = null;
  try {
    installationId = attendanceInstallationId();
  } catch {
    // من غير معرف تثبيت مفيش مراجعة عند الـ API، بس السجل المحلي بينمسح.
  }
  try {
    await disablePush(installationId);
  } catch {
    // الإيقاف بيلتف؛ الـ catch ده حماية أخيرة عشان تسجيل الخروج ما يتوقفش.
  }
}
