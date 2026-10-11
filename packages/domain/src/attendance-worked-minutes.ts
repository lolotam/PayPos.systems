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
 * يحسب دقائق العمل الفعلية لليوم وبريك BW-Q8 فقط بين جلستين محتسبتين متجاورتين لنفس الوردية.
 * طرفا الفجوة داخل نافذة البريك بما فيه حدّاها؛ أي غياب خارجها لا يتحول إلى عمل.
 *
 * @param sessions جلسات يوم العمل الواحد في الفرع
 * @param shifts ورديات ذلك اليوم وبريكها المثبت
 * @returns دقائق صحيحة، والفترات التي لا تكمل دقيقة لا تضيف دقيقة
 */
export function workedAttendanceMinutes(sessions: readonly ReportSession[], shifts: readonly ReportShift[]): number {
  const counted = sessions.filter(isCountedAttendanceSession)
    .toSorted((a, b) => Date.parse(a.clock_in) - Date.parse(b.clock_in));
  let elapsed = counted.reduce((total, session) => total +
    Math.max(0, Date.parse(session.clock_out ?? session.clock_in) - Date.parse(session.clock_in)), 0);
  for (let index = 1; index < counted.length; index++) {
    const previous = counted[index - 1], next = counted[index];
    if (!previous || !next || previous.clock_out === null || previous.scheduled_end === null ||
      next.scheduled_end === null || Date.parse(previous.scheduled_end) !== Date.parse(next.scheduled_end)) continue;
    const shift = shifts.find((candidate) => Date.parse(candidate.ends_at) === Date.parse(next.scheduled_end ?? '') &&
      candidate.working_date === previous.working_date);
    if (!shift?.break_starts_at || !shift.break_ends_at) continue;
    const out = Date.parse(previous.clock_out), back = Date.parse(next.clock_in);
    const start = Date.parse(shift.break_starts_at), end = Date.parse(shift.break_ends_at);
    if (start <= out && out <= back && back <= end) elapsed += back - out;
  }
  return Math.floor(elapsed / 60_000);
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
