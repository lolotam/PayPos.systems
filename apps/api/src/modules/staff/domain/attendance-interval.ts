/** فترة حضور للمقارنة؛ نهاية فارغة تعني جلسة مفتوحة بلا حد نهائي. */
export interface AttendanceInterval {
  id: string;
  clock_in: string;
  clock_out: string | null;
  voided_at?: string | null;
}

/**
 * يطبق CA-Q8 (2026-10-08): فترة موجبة ماضية بحد ١٦ ساعة شامل، والأطراف المتلامسة مسموحة.
 *
 * @param start بداية الفترة
 * @param end نهاية الفترة
 * @param now الوقت المحقون للفحص
 * @param neighbours جلسات الموظف، بما فيها المفتوحة
 * @param excludeId الجلسة الجاري تصحيحها إن وجدت
 * @returns هل الفترة مرفوضة بسبب الوقت أو التداخل
 */
export function attendanceIntervalRefused(
  start: Date,
  end: Date,
  now: Date,
  neighbours: readonly AttendanceInterval[],
  excludeId: string | null,
): boolean {
  const from = start.getTime();
  const to = end.getTime();
  if (
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    to <= from ||
    from > now.getTime() ||
    to > now.getTime() ||
    to - from > 16 * 60 * 60 * 1000
  )
    return true;
  return neighbours.some(
    (other) =>
      other.id !== excludeId &&
      !other.voided_at &&
      from <
        (other.clock_out === null
          ? Number.POSITIVE_INFINITY
          : new Date(other.clock_out).getTime()) &&
      new Date(other.clock_in).getTime() < to,
  );
}
