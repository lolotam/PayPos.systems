import type { OpeningHoursValue } from './opening-hours.ts';
import { dayEnd } from './request-day.ts';

const RECORDING_GRACE_MS = 30 * 60 * 1000;

/**
 * يكتشف التسجيل الذي تجاوز نهاية يوم طلبه بأكثر من ثلاثين دقيقة؛ تمام الثلاثين مقبول.
 *
 * @param recordedAt لحظة تسجيل الزيارة لا لحظة حدوثها
 * @param requestDay يوم الطلب المحسوب من occurredAt
 * @param timeZone المنطقة الفعّالة للفرع
 * @param openingHours مواعيد الفرع أو null عند عدم ضبطها
 * @returns true عندما يجب استبعاد الزيارة من الجدولة والإسناد
 */
export function isLateEntry(
  recordedAt: Date,
  requestDay: string,
  timeZone: string,
  openingHours: OpeningHoursValue | null,
): boolean {
  const end = dayEnd(requestDay, timeZone, openingHours);
  return recordedAt.getTime() > end.getTime() + RECORDING_GRACE_MS;
}
