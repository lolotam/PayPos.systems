import { ratingSchedule, type RatingSchedule } from './rating-schedule.ts';
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
  | {
      readonly kind: 'CLAIM';
      readonly performers: readonly string[];
      readonly schedule: StoredClaimSchedule;
    };

/** قرار إلغاء نهائي يُحسم قبل قراءة حالة اليوم، فلا تتغير أولوية D-B5 بسبب قارئ لاحق. */
export type ClaimEarlyDecision = Extract<
  ClaimDecision,
  { readonly kind: 'OPTED_OUT' | 'REQUESTS_OFF' | 'PAST_DEADLINE' }
>;

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
 * يفصل قرار الإيقاف عن أي قراءة لاحقة، حتى لا يفشل الإلغاء الملزم بسبب قارئ لا يحتاجه القرار.
 *
 * @param optedOutAt لحظة إيقاف العميل لطلبات التقييم، أو null
 * @returns قرار الإلغاء، أو طلب قراءة مفتاح النشاط عند الحاجة
 */
export function decideClaimOptOut(
  optedOutAt: Date | null,
): Extract<ClaimDecision, { readonly kind: 'OPTED_OUT' }> | { readonly kind: 'READ_SWITCH' } {
  return optedOutAt === null ? { kind: 'READ_SWITCH' } : { kind: 'OPTED_OUT' };
}

/**
 * يقرر ما يمكن حسمه قبل قراءة حالة اليوم، بنفس ترتيب D-B5: الإيقاف ثم المفتاح ثم الموعد المخزن.
 *
 * @param input الساعة والمفتاح وتفضيل العميل والجدولة المخزنة
 * @returns قرار إلغاء نهائي، أو طلب قراءة حالة اليوم عند الحاجة
 */
export function decideClaimBeforeDayState(
  input: Pick<ClaimDecisionInput, 'now' | 'switchEnabled' | 'optedOutAt' | 'stored'>,
): ClaimEarlyDecision | { readonly kind: 'READ_DAY_STATE' } {
  const optedOut = decideClaimOptOut(input.optedOutAt);
  if (optedOut.kind === 'OPTED_OUT') return optedOut;
  if (!input.switchEnabled) return { kind: 'REQUESTS_OFF' };
  if (
    input.stored.sendDeadline !== null &&
    input.stored.sendDeadline.getTime() < input.now.getTime()
  )
    return { kind: 'PAST_DEADLINE' };
  return { kind: 'READ_DAY_STATE' };
}

/**
 * يقرر مصير طلب التقييم وقت المطالبة، والقرار من حالة اليوم نفسها لا من الصف المخزّن.
 *
 * ترتيب الفحص: الإيقاف، ثم المفتاح، ثم الموعد النهائي المخزّن، ثم حالة اليوم؛ وبعد ما
 * الجدولة تتعاد من آخر زيارة بيتفحص الموعد النهائي بتاعها كمان، لأن آخر زيارة ممكن
 * تكون في فرع بيقفل بدري والجدولة المخزنة لسه ما انتهتش.
 *
 * @param input المدخلات المحقونة وحالة اليوم
 * @returns قرار المطالبة: إلغاء، أو إعادة جدولة، أو مطالبة بنسخة المنفذين
 */
export function decideClaim(input: ClaimDecisionInput): ClaimDecision {
  const early = decideClaimBeforeDayState(input);
  if (early.kind !== 'READ_DAY_STATE') return early;
  const latest = input.sessions.at(-1);
  if (latest === undefined) return { kind: 'NO_ACTIVE_LINE' };
  const place = input.placeByBranch.get(latest.branchId);
  if (place === undefined) throw new RangeError('BRANCH_SCHEDULE_MISSING');
  const recomputed = ratingSchedule(latest, place.openingHours, place.timeZone);
  // الموعد النهائي بيتفحص كمان على الجدولة المعاد حسابها: الزيارة الأخيرة ممكن تكون في
  // فرع بيقفل بدري، والطلب يتطالب بعد آخر وقت إرسال للجدولة المستعملة.
  if (recomputed.sendDeadline !== null && recomputed.sendDeadline.getTime() < input.now.getTime())
    return { kind: 'PAST_DEADLINE' };
  const schedule: StoredClaimSchedule = {
    branchId: latest.branchId,
    dueAt: recomputed.dueAt,
    sendDeadline: recomputed.sendDeadline,
  };
  const performers = performersOf(input.sessions);
  if (!sameSchedule(input.stored, recomputed)) {
    // الزيارة الأحدث حرّكت الموعد: إعادة جدولة لو الموعد الجديد لسه قدام، والمطالبة لو فات.
    if (schedule.dueAt.getTime() > input.now.getTime()) return { kind: 'RESCHEDULED', schedule };
    return { kind: 'CLAIM', performers, schedule };
  }
  if (input.stored.dueAt.getTime() > input.now.getTime()) return { kind: 'NOT_DUE' };
  return { kind: 'CLAIM', performers, schedule };
}

/**
 * يقارن الموعدين المشتركين بين الجدولة المخزنة والمعاد حسابها؛ الفرع لسه جزء من الجدولة
 * المكتوبة، بس هو مش من حقول الموعد المعاد حسابه فيفصله المستدعي.
 *
 * @param stored الجدولة المخزنة في الصف
 * @param next الموعد المعاد حسابه من آخر زيارة
 * @returns هل الموعدان واحد
 */
function sameSchedule(stored: StoredClaimSchedule, next: RatingSchedule): boolean {
  return (
    stored.dueAt.getTime() === next.dueAt.getTime() &&
    (stored.sendDeadline?.getTime() ?? null) === (next.sendDeadline?.getTime() ?? null)
  );
}

/**
 * منفذو يوم الطلب كلهم بلا تكرار، بترتيب ظهورهم في الزيارات.
 *
 * @param sessions زيارات يوم الطلب كما ترجع من المصدر الموثوق
 * @returns معرّفات المنفذين بترتيب أول ظهور
 */
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
