/**
 * حساب اليوم المحلي للنشاط وتاريخ التذكير (FR-053، CS-Q17 = PP-17.5).
 *
 * التذكير بيتبعت في التوقيت المحلي للنشاط: اليوم الثالث والخامس من الشهر،
 * بعد التاسعة صباحًا. كل الحساب هنا دوال خالصة على لحظة معروفة ومنطقة زمنية IANA،
 * فمافيش clock ولا Date.now() جوه الدالة (CLAUDE.md §4.3).
 */

/** اللحظة المحلية في النشاط: السنة والشهر واليوم والدقائق منذ منتصف الليل المحلي. */
export interface BusinessLocalMoment {
  readonly year: number;
  /** الشهر من 1 إلى 12. */
  readonly month: number;
  readonly day: number;
  /** الدقائق منذ منتصف الليل المحلي. */
  readonly minutes: number;
}

/** الأيام اللي بتبعت فيها تذكير: الثالث والخامس. */
export const REMINDER_DAYS = [3, 5] as const;

/** اليوم اللي بتبعت منه التذكيرات: التاسعة صباحًا بالتوقيت المحلي (CS-Q17 = PP-17.5). */
export const REMINDER_START_MINUTES = 9 * 60;

/**
 * يقرأ اللحظة المحلية للحظة معروفة في منطقة زمنية IANA.
 *
 * @param now     اللحظة المرجعية
 * @param timeZone المنطقة الزمنية IANA للنشاط
 * @returns اللحظة المحلية
 */
export function businessLocalMoment(now: Date, timeZone: string): BusinessLocalMoment {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    minutes: value('hour') * 60 + value('minute'),
  };
}

/**
 * يوم التذكير المستحق للحظة محلية: الثالث أو الخامس بعد التاسعة، ونص null لما يكون مش مستحق.
 *
 * @param moment اللحظة المحلية
 * @returns اليوم المستحق، أو null
 */
export function reminderDayFor(moment: BusinessLocalMoment): 3 | 5 | null {
  if (moment.minutes < REMINDER_START_MINUTES) return null;
  if (moment.day === 3) return 3;
  if (moment.day === 5) return 5;
  return null;
}

/**
 * الشهر السابق للشهر المعطى بصيغة YYYY-MM؛ التذكير بيشدّ الشهر اللي قبله.
 *
 * @param year  السنة
 * @param month الشهر (1 إلى 12)
 * @returns الشهر السابق بصيغة YYYY-MM
 */
export function previousPeriod(year: number, month: number): string {
  const previous = month === 1 ? 12 : month - 1;
  const previousYear = month === 1 ? year - 1 : year;
  return `${String(previousYear).padStart(4, '0')}-${String(previous).padStart(2, '0')}`;
}

/**
 * تاريخ التذكير بصيغة YYYY-MM-DD من اللحظة المحلية (بدون تحويل المناطق الزمنية).
 *
 * @param moment اللحظة المحلية
 * @returns التاريخ بصيغة YYYY-MM-DD
 */
export function reminderDate(moment: BusinessLocalMoment): string {
  return `${String(moment.year).padStart(4, '0')}-${String(moment.month).padStart(2, '0')}-${String(moment.day).padStart(2, '0')}`;
}
