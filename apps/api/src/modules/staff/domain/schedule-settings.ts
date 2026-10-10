import { ScheduleError, type ConcreteShift, type WeeklyShift } from './schedule-types.ts';

/** غياب صف الإعدادات يعطي ثلاث ورديات وفق قرار المالك S020-SHIFTS (9 أكتوبر 2026). */
export const DEFAULT_MAX_SHIFTS_PER_DAY = 3;
/**
 * يختار حد الفرع ثم النشاط ثم ثلاث ورديات عند غياب الإعدادين.
 *
 * @param branchValue قيمة الفرع الخاصة إن وجدت
 * @param businessValue قيمة النشاط إن وجدت
 * @returns الحد الفعلي للفرع
 */
export function effectiveMaxShiftsPerDay(
  branchValue: number | null,
  businessValue: number | null,
): number {
  return branchValue ?? businessValue ?? DEFAULT_MAX_SHIFTS_PER_DAY;
}
/**
 * يحدد مصدر الحد حتى يميز المالك القيمة الخاصة عن الموروثة.
 *
 * @param branchValue قيمة الفرع الخاصة
 * @param businessValue قيمة النشاط
 * @returns مصدر القيمة الفعلية
 */
export function scheduleSettingsSource(
  branchValue: number | null,
  businessValue: number | null,
): 'branch' | 'business' | 'default' {
  return branchValue !== null ? 'branch' : businessValue !== null ? 'business' : 'default';
}
/**
 * يسمح بحفظ قالب يناسب فرعاً نشطاً واحداً على الأقل؛ غياب الفروع يعيد حد النشاط.
 *
 * @param branchValues الحدود الفعلية للفروع النشطة فقط
 * @param businessValue قيمة النشاط إن وجدت
 * @returns أكبر حد فعلي أو حد النشاط عند غياب الفروع
 */
export function templateMaxShiftsPerDay(
  branchValues: readonly number[],
  businessValue: number | null,
): number {
  return branchValues.length
    ? Math.max(...branchValues)
    : effectiveMaxShiftsPerDay(null, businessValue);
}
/** حقول الوردية التي تغير عدد ورديات اليوم؛ البريك لا يضيف وردية فلا يخضع اليوم للحد بسببه. */
type ScheduleDayShift = Pick<
  ConcreteShift,
  'day' | 'working_date' | 'start' | 'end' | 'starts_at' | 'ends_at'
>;
/** حقول نمط القالب التي تغير عدد ورديات اليوم دون البريك. */
type PatternDayShift = Pick<WeeklyShift, 'day' | 'start' | 'end'>;
/** الحدود المعتمدة من المالك MS-Q3 وليست حدوداً مرتبطة بنوع النشاط. */
export const MAX_SHIFTS_PER_DAY_RANGE = { min: 1, max: 4 } as const;

/**
 * يثبت عدد الورديات الصحيح ضمن نطاق المالك من واحدة إلى أربع.
 *
 * @param value الحد المطلوب
 * @returns لا قيمة؛ يرفض الكسور والقيم خارج النطاق
 */
export function validateMaxShiftsPerDay(value: number): void {
  if (
    !Number.isInteger(value) ||
    value < MAX_SHIFTS_PER_DAY_RANGE.min ||
    value > MAX_SHIFTS_PER_DAY_RANGE.max
  )
    throw new ScheduleError('VALIDATION_FAILED');
}

/**
 * يحدد أيام البداية المتغيرة بالقيم الست كي لا يخضع اليوم المحفوظ دون تغيير لحد جديد.
 * ترتيب الورديات ومفاتيح JSON لا يمثل تغييراً؛ الإضافة والإزالة تمثلان تغييراً.
 *
 * @param before الورديات المحفوظة
 * @param after الورديات المطلوبة
 * @returns تواريخ البداية المتغيرة مرتبة
 */
export function changedScheduleDays(
  before: readonly ScheduleDayShift[],
  after: readonly ScheduleDayShift[],
): string[] {
  const dates = [...new Set([...before, ...after].map((s) => s.working_date))].sort();
  const onDay = (shifts: readonly ScheduleDayShift[], date: string) =>
    JSON.stringify(
      shifts
        .filter((s) => s.working_date === date)
        .map((s) => JSON.stringify([s.day, s.working_date, s.start, s.end, s.starts_at, s.ends_at]))
        .sort(),
    );
  return dates.filter((date) => onDay(before, date) !== onDay(after, date));
}

/**
 * يحدد أيام نمط القالب المتغيرة ليبقى تعديل الاسم وحده مسموحاً بعد خفض الحد.
 *
 * @param before النمط المحفوظ
 * @param after النمط المطلوب
 * @returns أرقام أيام الأسبوع المتغيرة مرتبة من السبت
 */
export function changedPatternDays(
  before: readonly PatternDayShift[],
  after: readonly PatternDayShift[],
): number[] {
  const days = [...new Set([...before, ...after].map((s) => s.day))].sort((a, b) => a - b);
  const onDay = (shifts: readonly PatternDayShift[], day: number) =>
    JSON.stringify(
      shifts
        .filter((s) => s.day === day)
        .map((s) => JSON.stringify([s.start, s.end]))
        .sort(),
    );
  return days.filter((day) => onDay(before, day) !== onDay(after, day));
}
