import {
  applyApprovedLeave,
  shiftNotClockedInParameters,
  type AppliedLeave,
  type LeaveInterval,
  type NameFallback,
  type NoticeParameter,
} from './not-clocked-in.ts';

/** خروج قبل بداية البريك بعشر دقائق أو أقل يُحسب خروجاً للبريك (BW-Q11). */
export const BREAK_OUT_LEAD_MS = 10 * 60 * 1000;

/** قرار الوظيفة لبريك وردية واحدة؛ الرجوع لفرع آخر يكتب إشعاراً بدل تنبيه الغياب (BW-Q10). */
export type BreakNotReturnedDecision =
  'ALERT' | 'WAIT' | 'NO_BREAK_OUT' | 'RETURNED' | 'RETURNED_OTHER_BRANCH' | 'EXCUSED' | 'STALE' | 'INELIGIBLE';

/** أول بصمة رجوع بعد خروج البريك في نفس النشاط، وأسماء فرع الرجوع لإشعار مدير فرع الخروج. */
export interface BreakReturn {
  readonly branchId: string;
  readonly clockIn: Date;
  readonly nameAr: string | null;
  readonly nameEn: string;
}

/** الوردية وبريكها كما خُزّنت لحظات UTC. */
export interface BreakShiftSpan {
  readonly workingDate: string;
  readonly endsAt: Date;
  readonly breakEndsAt: Date;
}

/** الحقائق التي يقرر بها domain بعد إعادة القراءة تحت القفل. */
export interface BreakNotReturnedFacts {
  readonly now: Date;
  readonly shiftEndsAt: Date;
  readonly alertAt: Date;
  readonly excused: boolean;
  readonly deleted: boolean;
  readonly contractEnd: string | null;
  readonly workingDate: string;
  readonly breakOutAt: Date | null;
  readonly shiftBranchId: string;
  readonly returnedBranchId: string | null;
}

/** معامل قالب break_not_returned؛ آخر معامل ساعة نهاية البريك بدل ساعة بداية الوردية. */
export interface BreakNoticeParameter {
  readonly name: Exclude<NoticeParameter['name'], 'shift_start'> | 'break_end';
  readonly type: 'text';
  readonly value: string;
}

/**
 * لحظة تنبيه عدم الرجوع بعد الإجازات المعتمدة، والمرساة آخر البريك لا بداية الوردية.
 * قاعدة الإجازة هي نفسها في تنبيه عدم الحضور (NC-Q6): اليومية تُعفي، والجزئية التي تغطي آخر البريك تؤخر التنبيه.
 *
 * @param shift يوم العمل ونهاية الوردية ونهاية البريك
 * @param leaves إجازات الموظفة المرشحة؛ غير المعتمدة تُهمل
 * @param graceMs مهلة الرجوع
 * @returns الإعفاء أو لحظة التنبيه
 */
export function breakReturnDeadline(
  shift: BreakShiftSpan,
  leaves: readonly LeaveInterval[],
  graceMs: number,
): AppliedLeave {
  return applyApprovedLeave(
    { workingDate: shift.workingDate, startsAt: shift.breakEndsAt, endsAt: shift.endsAt },
    leaves,
    graceMs,
  );
}

/**
 * يقرر مصير بريك الوردية بالترتيب الملزم: منتهية، غير مؤهلة، بلا خروج في البريك، إجازة، رجعت، انتظار، وإلا تنبيه.
 * التي لم تبصم خروجاً للبريك لا تُنبَّه أبداً لأن الاختيار يطلب التنبيه على عدم الرجوع فقط.
 * الرجوع في أي فرع للنشاط حتى لحظة القرار يسقط تنبيه الغياب؛ الفرع الآخر له إشعار مستقل (BW-Q10).
 *
 * @param facts اللحظة والوردية والإجازة والخروج والرجوع بعد القفل
 * @returns القرار
 */
export function breakNotReturnedDecision(facts: BreakNotReturnedFacts): BreakNotReturnedDecision {
  if (
    facts.now.getTime() >= facts.shiftEndsAt.getTime() ||
    facts.alertAt.getTime() >= facts.shiftEndsAt.getTime()
  )
    return 'STALE';
  if (facts.deleted || (facts.contractEnd !== null && facts.contractEnd < facts.workingDate))
    return 'INELIGIBLE';
  if (facts.breakOutAt === null) return 'NO_BREAK_OUT';
  if (facts.excused) return 'EXCUSED';
  if (facts.returnedBranchId !== null)
    return facts.returnedBranchId === facts.shiftBranchId ? 'RETURNED' : 'RETURNED_OTHER_BRANCH';
  if (facts.now.getTime() < facts.alertAt.getTime()) return 'WAIT';
  return 'ALERT';
}

/**
 * أحدث نهاية بريك يمكن أن تكون مستحقة الآن، ليقرأ التخزين صفحة أصغر.
 *
 * @param now لحظة الدورة
 * @param graceMs مهلة الرجوع
 * @returns البريكات التي انتهت عند هذه اللحظة أو قبلها هي المرشحة
 */
export function dueBreakCutoff(now: Date, graceMs: number): Date {
  return new Date(now.getTime() - graceMs);
}

/**
 * هل مضت مهلة الرجوع عن آخر البريك؟
 * الدالة تحرس توقيت إشعار «رجعت لفرع آخر» بعد ما حد المرشحين نزل دقيقة، فالتوقيت ما يتحركش مع القاعدة.
 *
 * @param breakEndsAt آخر البريك
 * @param at لحظة القرار
 * @param graceMs مهلة الرجوع بالمللي ثانية
 * @returns true لو المهلة مضت عند لحظة القرار
 */
export function graceElapsed(breakEndsAt: Date, at: Date, graceMs: number): boolean {
  return at.getTime() >= breakEndsAt.getTime() + graceMs;
}

/**
 * أول لحظة يُحسب عندها الخروج خروجاً للبريك: بدايته ناقص المهلة، فخروج 12:50 لبريك 13:00 خروج للبريك (BW-Q11).
 *
 * @param breakStartsAt بداية البريك
 * @param leadMs كم قبل البداية يُقبل الخروج
 * @returns بداية نافذة الخروج، شاملة
 */
export function breakOutWindowStart(breakStartsAt: Date, leadMs: number): Date {
  return new Date(breakStartsAt.getTime() - leadMs);
}

/**
 * معاملات قالب break_not_returned باللغتين، بنفس حماية أسماء العرض في تنبيه عدم الحضور.
 *
 * @param employeeNameAr اسم الموظفة العربي أو null
 * @param employeeNameEn اسم الموظفة الإنجليزي
 * @param branchNameAr اسم الفرع العربي أو null
 * @param branchNameEn اسم الفرع الإنجليزي
 * @param breakEnd نهاية البريك المحلية HH:MM
 * @param fallback الأسماء العامة من الكتالوج
 * @returns المعاملات بالترتيب، أو null إذا لم تكن الساعة HH:MM
 */
export function breakNotReturnedParameters(
  employeeNameAr: string | null,
  employeeNameEn: string,
  branchNameAr: string | null,
  branchNameEn: string,
  breakEnd: string,
  fallback?: NameFallback,
): readonly BreakNoticeParameter[] | null {
  const shared = shiftNotClockedInParameters(
    employeeNameAr, employeeNameEn, branchNameAr, branchNameEn, breakEnd, fallback,
  );
  if (shared === null) return null;
  return shared.map((parameter) =>
    parameter.name === 'shift_start'
      ? { name: 'break_end', type: 'text', value: parameter.value }
      : { name: parameter.name, type: 'text', value: parameter.value },
  );
}

/**
 * أسماء الموظفة وفرع الرجوع الآمنة لإشعار BW-Q10، بنفس حماية الأسماء في تنبيه الغياب.
 *
 * @param employeeNameAr اسم الموظفة العربي
 * @param employeeNameEn اسم الموظفة الإنجليزي
 * @param returned أول رجوع في النشاط بعد الخروج
 * @param fallback الأسماء العامة من الكتالوج
 * @returns معاملات الأسماء فقط بلا وقت البريك
 */
export function breakReturnedOtherBranchParameters(
  employeeNameAr: string | null,
  employeeNameEn: string,
  returned: BreakReturn,
  fallback: NameFallback,
): readonly BreakNoticeParameter[] {
  return (breakNotReturnedParameters(
    employeeNameAr, employeeNameEn, returned.nameAr, returned.nameEn, '00:00', fallback,
  ) ?? []).filter((parameter) => parameter.name !== 'break_end');
}
