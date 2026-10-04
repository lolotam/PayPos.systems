const HOUR_MS = 60 * 60 * 1000;
const AFTER_SHIFT_END_MS = 4 * HOUR_MS;
const AFTER_CLOCK_IN_MS = 12 * HOUR_MS;
const MISSED_OUT_MS = 16 * HOUR_MS;

/** حقائق الجلسة المفتوحة التي تحتاجها القاعدة فقط؛ لا تحمل أي ساعات أو مبالغ. */
export interface MissedOutSession {
  readonly id: string;
  readonly employeeId: string;
  readonly clockIn: Date;
  /** نهاية الوردية كما ثبتها clock-in (AT-Q5) أو null بلا جدول. */
  readonly scheduledEnd: Date | null;
  readonly suspectedRaised: boolean;
}

/** ما يجب فعله بالجلسة الآن؛ NONE تعني أن الوقت لم يحن أو أن الاشتباه مرفوع بالفعل. */
export type MissedOutAction = 'NONE' | 'RAISE_SUSPECTED' | 'CLOSE_MISSED_OUT';

/**
 * بيحسب لحظة رفع اشتباه نسيان الخروج لجلسة مفتوحة.
 * القاعدة: نهاية الوردية + ٤ ساعات، وبلا جدول clock-in + ١٢ ساعة (SPEC §7)؛ الساعات مدة منقضية
 * لا ساعة حائط، لأن نهاية الوردية مثبتة لحظةً UTC بتوقيت الفرع (الليلي وDST محسومان عند clock-in).
 * وردية انتهت عند clock-in أو قبله ليست وردية الجلسة، فتعامل كأن لا جدول.
 *
 * @param session الجلسة المفتوحة ولقطة نهاية ورديتها
 * @returns لحظة استحقاق الاشتباه
 */
export function suspectedMissedOutDueAt(session: MissedOutSession): Date {
  // TODO(spec) MO-Q3: وردية الجلسة هي لقطة AT-Q5 عند clock-in؛ المنتهية قبلها ترجع لقاعدة ١٢ ساعة (موصى به).
  const end = session.scheduledEnd;
  if (end !== null && end.getTime() > session.clockIn.getTime())
    return new Date(end.getTime() + AFTER_SHIFT_END_MS);
  return new Date(session.clockIn.getTime() + AFTER_CLOCK_IN_MS);
}

/**
 * بيحسب حد ١٦ ساعة الذي تقفل عنده الجلسة MISSED_OUT.
 * قرار المالك AT-Q6: القفل عند الحد نفسه مهما تأخر الاكتشاف، والاكتشاف يُسجل منفصلاً.
 *
 * @param clockIn لحظة فتح الجلسة
 * @returns لحظة clock-in + ١٦ ساعة
 */
export function missedOutDeadline(clockIn: Date): Date {
  return new Date(clockIn.getTime() + MISSED_OUT_MS);
}

/**
 * بيقرر خطوة الوظيفة لجلسة مفتوحة في لحظة واحدة مأخوذة بعد قفل State.
 * القاعدة: عند ١٦ ساعة أو بعدها MISSED_OUT، وقبلها اشتباه واحد عند استحقاقه؛ الحدود شاملة.
 * لو الاستحقاق نفسه بعد حد ١٦ ساعة فلا اشتباه، والقفل يأتي عند الحد.
 *
 * @param session الجلسة المفتوحة وهل رُفع اشتباهها
 * @param at لحظة القرار من الـ Clock المحقون
 * @returns الخطوة المطلوبة
 */
export function missedOutAction(session: MissedOutSession, at: Date): MissedOutAction {
  if (at.getTime() >= missedOutDeadline(session.clockIn).getTime()) return 'CLOSE_MISSED_OUT';
  if (session.suspectedRaised) return 'NONE';
  return at.getTime() >= suspectedMissedOutDueAt(session).getTime() ? 'RAISE_SUSPECTED' : 'NONE';
}

/**
 * بيحسب أحدث clock-in يمكن أن يستحق أي خطوة الآن، ليقرأ التخزين مرشحين أقل.
 * أقل استحقاق ممكن أكبر من clock-in + ٤ ساعات (نهاية وردية بعد البداية)، فالحد آمن ولا يسقط جلسة.
 *
 * @param at لحظة بدء الدورة
 * @returns الجلسات المفتوحة قبل هذه اللحظة أو عندها هي فقط المرشحة
 */
export function missedOutCandidateCutoff(at: Date): Date {
  return new Date(at.getTime() - AFTER_SHIFT_END_MS);
}
