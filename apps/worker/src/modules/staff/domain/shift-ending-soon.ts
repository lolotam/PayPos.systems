import {
  arabicDisplayName,
  DEFAULT_NAME_FALLBACK,
  englishDisplayName,
  type LeaveInterval,
  type NameFallback,
  type ShiftSpan,
} from './not-clocked-in.ts';

/** ساعة نهاية الوردية بنظام 24 ساعة؛ أي نص تاني معناها إن الجدول ما فيهاش وقت صالح. */
const SHIFT_END_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** نفس شريط الوردية بتاع تنبيه الغياب، معاد استخدامه في قاعدة الإجازة. */
export type ShiftEndSpan = ShiftSpan;

/** قرار التذكير لوردية واحدة؛ REMIND و SUPPRESS وحدهم بيكتبوا سطر في دفتر «دوامك قرب يخلص». */
export type ShiftEndingSoonDecision =
  'REMIND' | 'WAIT' | 'SUPPRESS' | 'EXCUSED' | 'NOT_PRESENT' | 'STALE' | 'INELIGIBLE';

/** الحقائق التي يقرر بها domain بعد إعادة القراءة تحت القفل. */
export interface ShiftEndingSoonFacts {
  readonly now: Date;
  readonly shiftEndsAt: Date;
  readonly remindAt: Date;
  readonly workingDate: string;
  readonly deleted: boolean;
  readonly contractEnd: string | null;
  readonly excused: boolean;
  readonly ruleEnabled: boolean;
  readonly hasOpenSession: boolean;
}

/** معامل قالب «دوامك قرب يخلص»: ساعة النهاية بنظام 24 ساعة واسم الفرع باللغتين. */
export interface EndsSoonParameter {
  readonly name: 'shift_end' | 'branch_name_ar' | 'branch_name_en';
  readonly type: 'text';
  readonly value: string;
}

/**
 * لحظة استحقاق تذكير «دوامك قرب يخلص»: نهاية الوردية ناقص المهلة، ولا تسبق بداية الوردية أبداً.
 * الحساب وقت منقضي على لحظات UTC، فالوردية الليلية وتغيير التوقيت الصيفي ما بيخربوش الحساب.
 * المهلة دايماً معامَل، والافتراضي (30 دقيقة) في قواعد التنبيهات نفسها مش هنا.
 *
 * @param startsAt بداية الوردية
 * @param endsAt نهاية الوردية
 * @param leadMs المهلة بالمللي ثانية
 * @returns لحظة الاستحقاق
 */
export function remindMoment(startsAt: Date, endsAt: Date, leadMs: number): Date {
  return new Date(Math.max(endsAt.getTime() - leadMs, startsAt.getTime()));
}

/**
 * هل الإجازة المعتمدة تعفي الموظفة من تذكير نهاية الوردية؟
 * اليومية تغطي يوم العمل كله؛ والجزئية تعفي بس لو بدأت قبل نهاية الوردية واوصلت ليها أو عدتها.
 * المعلّقة والمرفوضة والملغاة ما بتعفيش أبداً، والقاعدة ما بتحرّكش لحظة التذكير ولا بتمسحها.
 *
 * @param shift يوم العمل وبداية الوردية ونهايتها
 * @param leaves إجازات الموظفة المرشحة
 * @returns true لو الوردية معفاة من التذكير
 */
export function endsSoonLeave(shift: ShiftEndSpan, leaves: readonly LeaveInterval[]): boolean {
  return leaves.some((leave) => {
    if (leave.status !== 'APPROVED') return false;
    if (leave.kind === 'FULL_DAY')
      return leave.from <= shift.workingDate && shift.workingDate <= leave.to;
    return (
      leave.startsAt.getTime() < shift.endsAt.getTime() &&
      shift.endsAt.getTime() <= leave.endsAt.getTime()
    );
  });
}

/**
 * يقرر مصير تذكير نهاية الوردية بالترتيب الملزم: منتهية، غير مؤهلة، معفاة، لسه، مقفولة، مش موجودة، وإلا تذكير.
 * مفيش حد أدنى للوقت المتبقي: التذكير المتأخر بيتبعت طول ما الوردية شغالة (SE-Q2).
 * مفيش حالة «فات الوقت»: بعد نهاية الوردية القرار STALE وما يتكتبش سطر في الدفتر.
 * بس REMIND و SUPPRESS بيكتبوا سطر الدفتر؛ سطر SUPPRESS معناها القاعدة كانت مقفولة وقت الاستحقاق.
 *
 * @param facts اللحظة والوردية والقاعدة والحضور بعد القفل
 * @returns القرار
 */
export function shiftEndingSoonDecision(facts: ShiftEndingSoonFacts): ShiftEndingSoonDecision {
  // مقارنة تاريخ مش صالح (NaN) دايماً false، فالنفي بيقفل الباب: لحظة غلط معناها الوردية خلصت.
  if (!(facts.now.getTime() < facts.shiftEndsAt.getTime())) return 'STALE';
  if (facts.deleted || (facts.contractEnd !== null && facts.contractEnd < facts.workingDate))
    return 'INELIGIBLE';
  if (facts.excused) return 'EXCUSED';
  // نفس المنطق مع لحظة الاستحقاق: تاريخ مش صالح معناها لسه ما جهتش، فالتذكير ما ينطلقش.
  if (!(facts.now.getTime() >= facts.remindAt.getTime())) return 'WAIT';
  if (!facts.ruleEnabled) return 'SUPPRESS';
  if (!facts.hasOpenSession) return 'NOT_PRESENT';
  return 'REMIND';
}

/**
 * معاملات قالب «دوامك قرب يخلص»: ساعة نهاية الوردية بنظام 24 ساعة واسم الفرع باللغتين.
 * الاسم المرفوض (رابط أو هاتف) بيرجع للإنجليزي السليم أو للاسم العام الآمن، والقالب ما بيقعش.
 * ساعة النهاية بتفضل 24 ساعة من غير «م»، عشان المتلقي يشوفها على جهازه.
 *
 * @param branchNameAr اسم الفرع العربي أو null
 * @param branchNameEn اسم الفرع الإنجليزي
 * @param shiftEnd نهاية الوردية المحلية HH:MM
 * @param fallback الأسماء العامة من كتالوج اللغتين
 * @returns المعاملات بالترتيب، أو null إذا لم تكن الساعة HH:MM
 */
export function shiftEndsSoonParameters(
  branchNameAr: string | null,
  branchNameEn: string,
  shiftEnd: string,
  fallback: NameFallback = DEFAULT_NAME_FALLBACK,
): readonly EndsSoonParameter[] | null {
  if (!SHIFT_END_TIME.test(shiftEnd)) return null;
  return [
    named('shift_end', shiftEnd),
    named('branch_name_ar', arabicDisplayName(branchNameAr, branchNameEn, fallback.branchAr)),
    named('branch_name_en', englishDisplayName(branchNameEn, fallback.branchEn)),
  ];
}

function named(name: EndsSoonParameter['name'], value: string): EndsSoonParameter {
  return { name, type: 'text', value };
}
