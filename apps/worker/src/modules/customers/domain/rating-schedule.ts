import type { OpeningHoursValue } from './opening-hours.ts';
import { dayClose, requestDayOf } from './request-day.ts';

/** تأخير طلب التقييم ساعة بعد الزيارة ما لم يسبقه إغلاق الفرع. */
export const RATING_DELAY_MS = 60 * 60 * 1000;

/** سماح الإرسال ثلاثين دقيقة بعد الإغلاق حتى لا يلغي تنفيذ الطلب المستحق عنده. */
export const SEND_GRACE_MS = 30 * 60 * 1000;

/** موعدا معالجة طلب التقييم المشتقان من آخر زيارة ومواعيد فرعها. */
export interface RatingSchedule {
  readonly dueAt: Date;
  readonly sendDeadline: Date | null;
}

/**
 * يجدول الطلب بعد ساعة أو عند آخر إغلاق أيهما أسبق، ويمنح الإرسال ثلاثين دقيقة بعده.
 *
 * @param lastSession آخر زيارة نشطة في يوم الطلب
 * @param openingHours مواعيد فرع آخر زيارة أو null
 * @param timeZone المنطقة الفعّالة لذلك الفرع
 * @returns dueAt وsendDeadline؛ الموعد النهائي null بلا إغلاق معروف
 */
export function ratingSchedule(
  lastSession: { occurredAt: Date },
  openingHours: OpeningHoursValue | null,
  timeZone: string,
): RatingSchedule {
  const occurredAt = lastSession.occurredAt;
  const day = requestDayOf(occurredAt, timeZone, openingHours);
  const close = dayClose(day, timeZone, openingHours);
  const delayed = occurredAt.getTime() + RATING_DELAY_MS;
  return {
    dueAt: new Date(close === null ? delayed : Math.min(delayed, close.getTime())),
    sendDeadline: close === null ? null : new Date(close.getTime() + SEND_GRACE_MS),
  };
}
