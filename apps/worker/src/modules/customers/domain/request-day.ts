import { clockMinutes, crossesMidnight, type OpeningHoursValue } from './opening-hours.ts';
import { addCivilDays, instantOf, isoWeekdayOf, localParts } from './zoned-time.ts';

/**
 * ينسب الزيارة ليوم تقييم واحد بتوقيت فرعها؛ ذيل فترة الليل قبل الإغلاق يتبع يوم بدايتها.
 *
 * @param occurredAt لحظة الزيارة
 * @param timeZone المنطقة الفعّالة للفرع
 * @param openingHours مواعيد الفرع أو null عند عدم ضبطها
 * @returns يوم الطلب بصيغة YYYY-MM-DD
 */
export function requestDayOf(
  occurredAt: Date,
  timeZone: string,
  openingHours: OpeningHoursValue | null,
): string {
  const local = localParts(occurredAt, timeZone);
  if (openingHours === null || openingHours.length === 0) return local.date;
  const previousDate = addCivilDays(local.date, -1);
  const previousDay = openingHours.find((day) => day.weekday === isoWeekdayOf(previousDate));
  const inOvernightTail = previousDay?.intervals.some(
    (interval) => crossesMidnight(interval) && local.minutes < clockMinutes(interval.closes),
  );
  return inOvernightTail === true ? previousDate : local.date;
}

/**
 * يحسب آخر إغلاق بين فترات يوم الطلب، وينقل إغلاق الفترة الليلية إلى اليوم المدني التالي.
 *
 * @param day يوم الطلب بصيغة YYYY-MM-DD
 * @param timeZone المنطقة الفعّالة للفرع
 * @param openingHours مواعيد الفرع أو null عند عدم ضبطها
 * @returns لحظة آخر إغلاق، أو null بلا مواعيد لهذا اليوم
 */
export function dayClose(
  day: string,
  timeZone: string,
  openingHours: OpeningHoursValue | null,
): Date | null {
  if (openingHours === null || openingHours.length === 0) return null;
  const openingDay = openingHours.find((entry) => entry.weekday === isoWeekdayOf(day));
  // يوم ناقص من المواعيد أو قائمة فاضية أو مواعيد غير مضبوطة: كلها معناها «مفيش إغلاق معروف» (إجابة المالك RT-Q15، PP-66).
  if (openingDay === undefined || openingDay.intervals.length === 0) return null;
  const lastClose = Math.max(
    ...openingDay.intervals.map(
      (interval) => clockMinutes(interval.closes) + (crossesMidnight(interval) ? 1440 : 0),
    ),
  );
  return instantOf(day, lastClose, timeZone);
}

/**
 * يحدد نهاية يوم الطلب لقبول التسجيل المتأخر: آخر إغلاق أو منتصف الليل بلا إغلاق معروف.
 *
 * @param day يوم الطلب بصيغة YYYY-MM-DD
 * @param timeZone المنطقة الفعّالة للفرع
 * @param openingHours مواعيد الفرع أو null عند عدم ضبطها
 * @returns لحظة نهاية اليوم المحلي
 */
export function dayEnd(
  day: string,
  timeZone: string,
  openingHours: OpeningHoursValue | null,
): Date {
  return dayClose(day, timeZone, openingHours) ?? instantOf(addCivilDays(day, 1), 0, timeZone);
}
