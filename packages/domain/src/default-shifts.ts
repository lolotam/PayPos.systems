export type DefaultShift = {
  start: string;
  end: string;
  break_start?: string | null | undefined;
  break_end?: string | null | undefined;
};
export type WeekdayDefaultShift = DefaultShift & { day: number };

/**
 * يحسب طول الدوام المحلي مع عبور منتصف الليل؛ البريك محسوب ضمن ساعات العمل وفق BW-Q4.
 *
 * @param entry بداية الدوام ونهايته المحليتان
 * @returns طول الدوام بالدقائق دون خصم البريك
 */
export function defaultShiftMinutes(entry: DefaultShift): number {
  const minute = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  const start = minute(entry.start), end = minute(entry.end);
  return end > start ? end - start : 1440 + end - start;
}

/**
 * يجمع دقائق الدوام الحالي للتواريخ المؤهلة فقط؛ المستدعي يفلتر التعيين والعقد وارتباط الفرع.
 *
 * @param entries الدوام الحالي لكل يوم، والسبت صفر
 * @param dates تواريخ مؤهلة للتعاقد والارتباط، ممثلة بيوم الأسبوع
 * @returns مجموع الدقائق شاملاً البريك
 */
export function contractedMinutes(entries: readonly WeekdayDefaultShift[], dates: readonly { weekday: number }[]): number {
  const minutes = new Map(entries.map((entry) => [entry.day, defaultShiftMinutes(entry)]));
  return dates.reduce((total, date) => total + (minutes.get(date.weekday) ?? 0), 0);
}

/**
 * يقارن يوم الجدول بالدوام الافتراضي؛ اليوم الفارغ أو غياب الافتراضي لا يظهر تنبيهاً وفق القاعدة أ.
 *
 * @param dayShifts ورديات اليوم في الفرع نفسه
 * @param entry الدوام الافتراضي لذلك اليوم أو غيابه
 * @returns وجود اختلاف في العدد أو الوقت أو البريك دون منع الحفظ
 */
export function dayDiffersFromDefault(dayShifts: readonly DefaultShift[], entry: DefaultShift | null): boolean {
  if (dayShifts.length === 0 || entry === null) return false;
  const shift = dayShifts[0];
  return dayShifts.length !== 1 || shift === undefined || shift.start !== entry.start || shift.end !== entry.end ||
    (shift.break_start ?? null) !== (entry.break_start ?? null) || (shift.break_end ?? null) !== (entry.break_end ?? null);
}
