import type { ReportSession, ReportShift } from './attendance-report-types.js';

/**
 * يختار الجلسات المحتسبة دون المفتوحة والملغاة؛ MISSED_OUT يحتاج تصحيح الخروج وفق AB-Q6.
 *
 * @param session الجلسة المثبتة
 * @returns هل يجوز احتساب حضورها وساعاتها
 */
export function isCountedAttendanceSession(session: ReportSession): boolean {
  return !session.voided && session.clock_out !== null &&
    (session.status === 'CLOSED' || (session.status === 'MISSED_OUT' && session.clock_out_corrected));
}

/**
 * يحسب دقائق العمل وبريك BW-Q8 بين الجلسات المتجاورة لكل وردية حتى عبر منتصف الليل.
 * رصيد الفجوة يمد جلسة الخروج وينسب ليوم دخولها؛ يُختار الشهر بعد حساب التجاور لا قبله.
 *
 * @param sessions جلسات الفرع مع سياق الوردية قبل الشهر وبعده
 * @param shifts ورديات الفترة وبريكها المثبت
 * @param month الشهر المطلوب أو undefined لجمع كل أيام الدخول
 * @returns دقائق صحيحة، والفترات التي لا تكمل دقيقة لا تضيف دقيقة
 */
export function workedAttendanceMinutes(sessions: readonly ReportSession[], shifts: readonly ReportShift[], month?: string): number {
  const counted = sessions.filter(isCountedAttendanceSession)
    .toSorted((a, b) => Date.parse(a.clock_in) - Date.parse(b.clock_in));
  const elapsedByDate = new Map<string, number>();
  const previousByShift = new Map<number, ReportSession>();
  for (const session of counted) {
    const elapsed = Math.max(0, Date.parse(session.clock_out ?? session.clock_in) - Date.parse(session.clock_in));
    elapsedByDate.set(session.working_date, (elapsedByDate.get(session.working_date) ?? 0) + elapsed);
    if (session.scheduled_end === null) continue;
    const shiftEnd = Date.parse(session.scheduled_end);
    const previous = previousByShift.get(shiftEnd);
    const shift = shifts.find((candidate) => Date.parse(candidate.ends_at) === shiftEnd);
    if (previous && shift) {
      elapsedByDate.set(previous.working_date, (elapsedByDate.get(previous.working_date) ?? 0) + breakCredit(previous, session, shift));
    }
    previousByShift.set(shiftEnd, session);
  }
  return [...elapsedByDate].filter(([date]) => month === undefined || date.startsWith(`${month}-`))
    .reduce((minutes, [, elapsed]) => minutes + Math.floor(elapsed / 60_000), 0);
}

function breakCredit(previous: ReportSession, next: ReportSession, shift: ReportShift): number {
  if (previous.clock_out === null || !shift.break_starts_at || !shift.break_ends_at) return 0;
  const out = Date.parse(previous.clock_out), back = Date.parse(next.clock_in);
  const start = Date.parse(shift.break_starts_at), end = Date.parse(shift.break_ends_at);
  return start <= out && out <= back && back <= end ? back - out : 0;
}

/**
 * يجمع التأخير المثبت، بما فيه الرجوع من البريك، دون خصمه من العمل؛ نسيان الخروج لا يلغي تأخير الدخول.
 *
 * @param sessions جلسات الفترة
 * @returns عدد الجلسات المتأخرة ودقائقها الصحيحة وفق AB-Q9c
 */
export function attendanceLateness(sessions: readonly ReportSession[]) {
  const late = sessions.filter((session) => !session.voided && session.status !== 'OPEN' && session.late_minutes > 0);
  return { late_count: late.length, late_minutes: late.reduce((sum, session) => sum + session.late_minutes, 0) };
}

/**
 * يعرض الدقائق كساعات ودقائق مع الحفاظ على إشارة الفرق السالب وفق AB-Q8.
 *
 * @param minutes دقائق صحيحة موجبة أو سالبة
 * @returns نص h:mm بلا تقريب الساعات
 */
export function attendanceHoursMinutes(minutes: number): string {
  return `${minutes < 0 ? '-' : ''}${Math.floor(Math.abs(minutes) / 60)}:${String(Math.abs(minutes) % 60).padStart(2, '0')}`;
}

/**
 * يعرض الساعات العشرية بمنزلتين للملف وفق AB-Q9d، ويقرب نصف جزء المئة بعيداً عن الصفر.
 *
 * @param minutes دقائق صحيحة موجبة أو سالبة
 * @returns ساعات عشرية قابلة للجمع في Excel
 */
export function attendanceDecimalHours(minutes: number): string {
  const hundredths = Math.round(Math.abs(minutes) * 100 / 60);
  return `${minutes < 0 && hundredths !== 0 ? '-' : ''}${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, '0')}`;
}
