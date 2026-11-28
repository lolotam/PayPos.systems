import type { OpeningHoursValue } from './opening-hours.ts';
import { dayEnd } from './request-day.ts';
import { localParts } from './zoned-time.ts';

const RECORDING_GRACE_MS = 30 * 60 * 1000;

/**
 * يكتشف التسجيل الذي تجاوز نهاية يوم طلبه بأكثر من ثلاثين دقيقة؛ تمام الثلاثين مقبول.
 * عند تثبيت يوم طلب ليلي قبل مسح الساعات الليلية أو تقصيرها، يحفظ للزيارة الليلية حدها التاريخي
 * بدل إسقاطها عند منتصف الليل بأثر رجعي.
 *
 * @param recordedAt لحظة تسجيل الزيارة لا لحظة حدوثها
 * @param requestDay يوم الطلب المثبَّت أو المحسوب
 * @param timeZone المنطقة الفعّالة للفرع
 * @param openingHours مواعيد الفرع أو null عند عدم ضبطها
 * @param occurredAt لحظة حدوث الزيارة لاكتشاف الزيارات الليلية المثبَّتة عبر منتصف الليل
 * @param historicalSendDeadline الموعد النهائي التاريخي للطلب القائم إن توفر لإبقاء السماح الليلي بعد مسح الساعات
 * @returns true عندما يجب استبعاد الزيارة من الجدولة والإسناد
 */
export function isLateEntry(
  recordedAt: Date,
  requestDay: string,
  timeZone: string,
  openingHours: OpeningHoursValue | null,
  occurredAt?: Date | undefined,
  historicalSendDeadline?: Date | null | undefined,
): boolean {
  const end = dayEnd(requestDay, timeZone, openingHours);
  let cutoffMs = end.getTime() + RECORDING_GRACE_MS;
  if (
    occurredAt !== undefined &&
    localParts(occurredAt, timeZone).date > requestDay &&
    end.getTime() < occurredAt.getTime()
  ) {
    cutoffMs = Math.max(
      cutoffMs,
      occurredAt.getTime() + RECORDING_GRACE_MS,
      historicalSendDeadline?.getTime() ?? 0,
    );
  }
  return recordedAt.getTime() > cutoffMs;
}
