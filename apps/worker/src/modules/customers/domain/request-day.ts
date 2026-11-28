import { clockMinutes, crossesMidnight, type OpeningHoursValue } from './opening-hours.ts';
import { addCivilDays, instantOf, isoWeekdayOf, localParts } from './zoned-time.ts';

const LEGACY_OVERNIGHT_DELAY_MS = 60 * 60 * 1000;
const LEGACY_OVERNIGHT_GRACE_MS = 30 * 60 * 1000;

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

/** رفض مؤقت عند اكتشاف تثبيت مسبق ليوم طلب مختلف للزيارة نفسه أثناء جدولة متزامنة. */
export class SessionRequestDayMismatchError extends Error {
  /**
   * يحفظ معرّف الزيارة واليوم المتوقع واليوم المثبَّت لإعادة الجدولة على اليوم الصحيح.
   *
   * @param sessionId معرف الزيارة
   * @param expectedDay يوم الطلب الذي بدأت المعاملة قفله
   * @param persistedDay يوم الطلب المثبَّت فعلياً للزيارة
   */
  constructor(
    readonly sessionId: string,
    readonly expectedDay: string,
    readonly persistedDay: string,
  ) {
    super('SESSION_REQUEST_DAY_MISMATCH');
    this.name = 'SessionRequestDayMismatchError';
  }
}

/** بيانات طلب اليوم المدني السابق اللازمة للتحقق من شمول زيارة ليلية قديمة قبل تعديل المواعيد. */
export interface PreviousDayOvernightRequest {
  readonly businessDate: string;
  readonly dueAt: Date;
  readonly sendDeadline: Date | null;
  readonly claimedAt?: Date | null;
}

/**
 * يتحقق مما إذا كانت زيارة غير موسومة بيوم طلب قد شملها طلب اليوم المدني السابق فعلياً قبل إزالة الساعات الليلية.
 *
 * @param visit لحظة حدوث الزيارة ولحظة تسجيلها إن توفرت
 * @param visit.occurredAt لحظة حدوث الزيارة
 * @param visit.recordedAt لحظة تسجيل الزيارة إن توفرت
 * @param request بيانات طلب التقييم لليوم المدني السابق
 * @param requestBranchTimeZone المنطقة الفعّالة لفرع ذلك الطلب
 * @returns true فقط عندما يثبت الموعد والإغلاق الليلي شمول الزيارة في ذلك الطلب دون امتصاص زيارات جديدة
 */
export function isCoveredByPreviousDayOvernightRequest(
  visit: { readonly occurredAt: Date; readonly recordedAt?: Date | undefined },
  request: PreviousDayOvernightRequest,
  requestBranchTimeZone: string,
): boolean {
  if (request.sendDeadline === null) return false;
  const closeMs = request.sendDeadline.getTime() - LEGACY_OVERNIGHT_GRACE_MS;
  if (localParts(new Date(closeMs), requestBranchTimeZone).date <= request.businessDate)
    return false;
  const occurredMs = visit.occurredAt.getTime();
  if (occurredMs >= closeMs) return false;
  const minExpectedDueMs = Math.min(occurredMs + LEGACY_OVERNIGHT_DELAY_MS, closeMs);
  if (request.dueAt.getTime() < minExpectedDueMs) return false;
  if (
    visit.recordedAt !== undefined &&
    request.claimedAt !== undefined &&
    request.claimedAt !== null &&
    visit.recordedAt.getTime() > request.claimedAt.getTime()
  )
    return false;
  return true;
}
