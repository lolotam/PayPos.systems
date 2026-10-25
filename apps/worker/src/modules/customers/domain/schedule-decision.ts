import { ratingSchedule } from './rating-schedule.ts';
import type { BranchSchedule, DaySession } from './sessions-of-day.ts';

/** القرار الوحيد الذي يغيّر صف طلب التقييم بعد قراءة حالة اليوم الموثوقة. */
export type ScheduleDecision =
  | { readonly kind: 'NO_ACTIVE_LINE' }
  | { readonly kind: 'PAST_DEADLINE' }
  | { readonly kind: 'OUTSIDE_BOOTSTRAP_WINDOW' }
  | {
      readonly kind: 'SCHEDULED';
      readonly branchId: string;
      readonly dueAt: Date;
      readonly sendDeadline: Date | null;
    };

/**
 * يمنع bootstrap من إنشاء تاريخ قديم بلا موعد نهائي؛ المسار الحي لا يمرر حد القطع.
 *
 * @param occurredAt وقت الزيارة النشطة التي اختارها الحساب الموثوق
 * @param sendDeadline آخر موعد للإرسال، أو null بلا ساعات عمل
 * @param cutoff حد bootstrap الاختياري
 * @returns true عندما تقع الزيارة خارج تاريخ bootstrap المسموح
 */
export function outsideBootstrapWindow(
  occurredAt: Date,
  sendDeadline: Date | null,
  cutoff?: Date,
): boolean {
  return cutoff !== undefined && sendDeadline === null && occurredAt.getTime() < cutoff.getTime();
}

/**
 * يقرر حالة الطلب من أحدث زيارة نشطة، ولا يلغيها عند الموعد النهائي نفسه بل بعده فقط.
 *
 * @param sessions زيارات اليوم مرتبة كما ترجعها sessionsOfDay
 * @param placeByBranch مواعيد ومنطقة كل فرع
 * @param now لحظة اتخاذ القرار المحقونة
 * @param bootstrapCutoff حد تاريخ bootstrap؛ غيابه يحافظ على سلوك الأحداث الحية
 * @returns غياب البنود أو انتهاء الموعد أو بيانات الجدولة من أحدث زيارة
 */
export function decideRequest(
  sessions: readonly DaySession[],
  placeByBranch: ReadonlyMap<string, BranchSchedule>,
  now: Date,
  bootstrapCutoff?: Date,
): ScheduleDecision {
  const latest = sessions.at(-1);
  if (latest === undefined) return { kind: 'NO_ACTIVE_LINE' };
  const place = placeByBranch.get(latest.branchId);
  if (place === undefined) throw new RangeError('BRANCH_SCHEDULE_MISSING');
  const schedule = ratingSchedule(latest, place.openingHours, place.timeZone);
  if (outsideBootstrapWindow(latest.occurredAt, schedule.sendDeadline, bootstrapCutoff))
    return { kind: 'OUTSIDE_BOOTSTRAP_WINDOW' };
  if (schedule.sendDeadline !== null && schedule.sendDeadline.getTime() < now.getTime())
    return { kind: 'PAST_DEADLINE' };
  return { kind: 'SCHEDULED', branchId: latest.branchId, ...schedule };
}
