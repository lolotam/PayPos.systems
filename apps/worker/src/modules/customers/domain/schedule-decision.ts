import { ratingSchedule } from './rating-schedule.ts';
import type { BranchSchedule, DaySession } from './sessions-of-day.ts';

/** القرار الوحيد الذي يغيّر صف طلب التقييم بعد قراءة حالة اليوم الموثوقة. */
export type ScheduleDecision =
  | { readonly kind: 'NO_ACTIVE_LINE' }
  | { readonly kind: 'PAST_DEADLINE' }
  | {
      readonly kind: 'SCHEDULED';
      readonly branchId: string;
      readonly dueAt: Date;
      readonly sendDeadline: Date | null;
    };

/**
 * يقرر حالة الطلب من أحدث زيارة نشطة، ولا يلغيها عند الموعد النهائي نفسه بل بعده فقط.
 *
 * @param sessions زيارات اليوم مرتبة كما ترجعها sessionsOfDay
 * @param placeByBranch مواعيد ومنطقة كل فرع
 * @param now لحظة اتخاذ القرار المحقونة
 * @returns غياب البنود أو انتهاء الموعد أو بيانات الجدولة من أحدث زيارة
 */
export function decideRequest(
  sessions: readonly DaySession[],
  placeByBranch: ReadonlyMap<string, BranchSchedule>,
  now: Date,
): ScheduleDecision {
  const latest = sessions.at(-1);
  if (latest === undefined) return { kind: 'NO_ACTIVE_LINE' };
  const place = placeByBranch.get(latest.branchId);
  if (place === undefined) throw new RangeError('BRANCH_SCHEDULE_MISSING');
  const schedule = ratingSchedule(latest, place.openingHours, place.timeZone);
  if (schedule.sendDeadline !== null && schedule.sendDeadline.getTime() < now.getTime())
    return { kind: 'PAST_DEADLINE' };
  return { kind: 'SCHEDULED', branchId: latest.branchId, ...schedule };
}
