import { ratingSchedule } from './rating-schedule.ts';
import type { BranchSchedule, DaySession } from './sessions-of-day.ts';

/** جدولة الطلب المخزنة في الصف وقت المطالبة. */
export interface StoredClaimSchedule {
  readonly branchId: string;
  readonly dueAt: Date;
  readonly sendDeadline: Date | null;
}

/** القرار الوحيد الذي يغيّر صف طلب التقييم بعد قراءة حالة اليوم الموثوقة. */
export type ClaimDecision =
  | { readonly kind: 'REQUESTS_OFF' }
  | { readonly kind: 'OPTED_OUT' }
  | { readonly kind: 'PAST_DEADLINE' }
  | { readonly kind: 'NOT_DUE' }
  | { readonly kind: 'NO_ACTIVE_LINE' }
  | { readonly kind: 'RESCHEDULED'; readonly schedule: StoredClaimSchedule }
  | { readonly kind: 'CLAIM'; readonly performers: readonly string[] };

export interface ClaimDecisionInput {
  /** لحظة اتخاذ القرار المحقونة. */
  readonly now: Date;
  /** هل طلبات التقييم مفعّلة للنشاط وقت المطالبة. */
  readonly switchEnabled: boolean;
  /** لحظة إيقاف العميل لطلبات التقييم، أو null. */
  readonly optedOutAt: Date | null;
  /** الجدولة المخزنة في الصف. */
  readonly stored: StoredClaimSchedule;
  /** زيارات يوم الطلب كما ترجع من المصدر الموثوق. */
  readonly sessions: readonly DaySession[];
  /** مواعيد كل فرع ظهر في زيارات اليوم. */
  readonly placeByBranch: ReadonlyMap<string, BranchSchedule>;
}

/**
 * يقرر مصير طلب التقييم وقت المطالبة، والقرار من حالة اليوم نفسها لا من الصف المخزّن.
 *
 * @param input المدخلات المحقونة وحالة اليوم
 * @returns قرار المطالبة: إلغاء، أو إعادة جدولة، أو مطالبة بنسخة المنفذين
 */
export function decideClaim(input: ClaimDecisionInput): ClaimDecision {
  if (!input.switchEnabled) return { kind: 'REQUESTS_OFF' };
  if (input.optedOutAt !== null) return { kind: 'OPTED_OUT' };
  if (input.stored.sendDeadline !== null && input.stored.sendDeadline.getTime() < input.now.getTime())
    return { kind: 'PAST_DEADLINE' };
  if (input.stored.dueAt.getTime() > input.now.getTime()) return { kind: 'NOT_DUE' };
  const latest = input.sessions.at(-1);
  if (latest === undefined) return { kind: 'NO_ACTIVE_LINE' };
  const place = input.placeByBranch.get(latest.branchId);
  if (place === undefined) throw new RangeError('BRANCH_SCHEDULE_MISSING');
  const schedule = ratingSchedule(latest, place.openingHours, place.timeZone);
  if (schedule.sendDeadline !== null && schedule.sendDeadline.getTime() < input.now.getTime())
    return { kind: 'PAST_DEADLINE' };
  if (!sameSchedule(input.stored, schedule))
    return {
      kind: 'RESCHEDULED',
      schedule: {
        branchId: latest.branchId,
        dueAt: schedule.dueAt,
        sendDeadline: schedule.sendDeadline,
      },
    };
  return { kind: 'CLAIM', performers: performersOf(input.sessions) };
}

function sameSchedule(stored: StoredClaimSchedule, next: StoredClaimSchedule): boolean {
  return (
    stored.branchId === next.branchId &&
    stored.dueAt.getTime() === next.dueAt.getTime() &&
    (stored.sendDeadline?.getTime() ?? null) === (next.sendDeadline?.getTime() ?? null)
  );
}

/** منفذو يوم الطلب كلهم بلا تكرار، بترتيب ظهورهم في الزيارات. */
function performersOf(sessions: readonly DaySession[]): string[] {
  const seen = new Set<string>();
  const performers: string[] = [];
  for (const session of sessions) {
    for (const line of session.lines) {
      for (const performer of line.performers) {
        if (seen.has(performer.employeeId)) continue;
        seen.add(performer.employeeId);
        performers.push(performer.employeeId);
      }
    }
  }
  return performers;
}
