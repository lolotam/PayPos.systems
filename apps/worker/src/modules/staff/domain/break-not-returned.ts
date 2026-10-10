import {
  applyApprovedLeave,
  interimNotClockedInRule,
  shiftNotClockedInParameters,
  type AppliedLeave,
  type InterimNotClockedInRule,
  type LeaveInterval,
  type NameFallback,
  type NoticeParameter,
} from './not-clocked-in.ts';

/** مهلة الرجوع من البريك: نفس مهلة التأخير العشر دقائق (AT-Q7)، منقضية من آخر البريك. */
export const BREAK_RETURN_GRACE_MS = 10 * 60 * 1000;

/** قرار الوظيفة لبريك وردية واحدة في لحظة واحدة؛ ALERT وحده يكتب إشعاراً. */
export type BreakNotReturnedDecision =
  'ALERT' | 'WAIT' | 'NO_BREAK_OUT' | 'RETURNED' | 'EXCUSED' | 'STALE' | 'INELIGIBLE';

/** القاعدة المؤقتة لتنبيه عدم الرجوع؛ نفس مستلمي وقناة تنبيه عدم الحضور حتى يصل PR 62. */
export interface InterimBreakNotReturnedRule {
  readonly enabled: boolean;
  readonly graceMs: number;
  readonly channel: InterimNotClockedInRule['channel'];
  readonly roles: InterimNotClockedInRule['roles'];
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
  readonly returned: boolean;
}

/** معامل قالب break_not_returned؛ آخر معامل ساعة نهاية البريك بدل ساعة بداية الوردية. */
export interface BreakNoticeParameter {
  readonly name: Exclude<NoticeParameter['name'], 'shift_start'> | 'break_end';
  readonly type: 'text';
  readonly value: string;
}

/**
 * القاعدة المؤقتة لتنبيه عدم الرجوع من البريك (BW-Q5، الاختيار 2).
 * تأخذ أدوار المستلمين والقناة من قاعدة تنبيه عدم الحضور حتى يبدلهما PR 62 معاً من مكان واحد.
 *
 * @returns القاعدة: مفعّلة، بمهلة عشر دقائق، داخل التطبيق، لمديري الفرع
 */
export function interimBreakNotReturnedRule(): InterimBreakNotReturnedRule {
  const shared = interimNotClockedInRule();
  return {
    enabled: shared.enabled,
    graceMs: BREAK_RETURN_GRACE_MS,
    channel: shared.channel,
    roles: shared.roles,
  };
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
 * الرجوع يُحسب حتى لحظة القرار، فمن رجعت قبل تشغيل الوظيفة لا تُنبَّه.
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
  if (facts.returned) return 'RETURNED';
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
