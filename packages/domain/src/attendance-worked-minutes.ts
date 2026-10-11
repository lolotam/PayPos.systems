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
 * رصيد الفجوة يستبعد أي وقت محتسب في جلسة أخرى وينسب ليوم الخروج؛ يُختار الشهر بعد حساب التجاور لا قبله.
 * فهرس نهاية الوردية واتحاد الفترات يحفظان قاعدة عدم تكرار الرصيد دون إعادة مسح الشهر لكل بريك.
 *
 * @param sessions جلسات الفرع مع سياق الوردية قبل الشهر وبعده
 * @param shifts ورديات الفترة وبريكها المثبت
 * @param month الشهر المطلوب أو undefined لجمع كل أيام الدخول
 * @returns دقائق صحيحة، والفترات التي لا تكمل دقيقة لا تضيف دقيقة
 */
export function workedAttendanceMinutes(sessions: readonly ReportSession[], shifts: readonly ReportShift[], month?: string): number {
  const counted = sessions.filter(isCountedAttendanceSession)
    .map((session) => ({ session, start: Date.parse(session.clock_in), end: Date.parse(session.clock_out ?? session.clock_in) }))
    .toSorted((a, b) => a.start - b.start);
  const elapsedByDate = new Map<string, number>();
  const covered = mergedCoverage(counted);
  const shiftsByEnd = new Map<number, ReportShift>();
  for (const shift of shifts) {
    const end = Date.parse(shift.ends_at);
    if (!Number.isNaN(end) && !shiftsByEnd.has(end)) shiftsByEnd.set(end, shift);
  }
  const previousByShift = new Map<number, ReportSession>();
  for (const { session, start, end } of counted) {
    const elapsed = Math.max(0, end - start);
    elapsedByDate.set(session.working_date, (elapsedByDate.get(session.working_date) ?? 0) + elapsed);
    if (session.scheduled_end === null) continue;
    const shiftEnd = Date.parse(session.scheduled_end);
    const previous = previousByShift.get(shiftEnd);
    const shift = shiftsByEnd.get(shiftEnd);
    if (previous && shift) {
      const gap = breakGap(previous, session, shift);
      if (gap) {
        const credit = creditUncoveredGap(gap, covered);
        elapsedByDate.set(previous.working_date, (elapsedByDate.get(previous.working_date) ?? 0) + credit);
      }
    }
    previousByShift.set(shiftEnd, session);
  }
  return [...elapsedByDate].filter(([date]) => month === undefined || date.startsWith(`${month}-`))
    .reduce((minutes, [, elapsed]) => minutes + Math.floor(elapsed / 60_000), 0);
}

function breakGap(previous: ReportSession, next: ReportSession, shift: ReportShift) {
  if (previous.clock_out === null || !shift.break_starts_at || !shift.break_ends_at) return null;
  const out = Date.parse(previous.clock_out), back = Date.parse(next.clock_in);
  const start = Date.parse(shift.break_starts_at), end = Date.parse(shift.break_ends_at);
  return start <= out && out <= back && back <= end ? { start: out, end: back } : null;
}

type Interval = { start: number; end: number };

function mergedCoverage(sorted: readonly Interval[]): Interval[] {
  const merged: Interval[] = [];
  for (const interval of sorted) {
    if (interval.end <= interval.start) continue;
    const last = merged.at(-1);
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
    else merged.push({ start: interval.start, end: interval.end });
  }
  return merged;
}

function creditUncoveredGap(gap: Interval, covered: Interval[]): number {
  let low = 0, high = covered.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if ((covered[mid]?.end ?? Infinity) < gap.start) low = mid + 1;
    else high = mid;
  }
  let index = low, credit = gap.end - gap.start;
  const union = { ...gap };
  while (index < covered.length) {
    const interval = covered[index];
    if (!interval || interval.start > gap.end) break;
    credit -= Math.max(0, Math.min(gap.end, interval.end) - Math.max(gap.start, interval.start));
    union.start = Math.min(union.start, interval.start);
    union.end = Math.max(union.end, interval.end);
    index++;
  }
  covered.splice(low, index - low, union);
  return credit;
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
