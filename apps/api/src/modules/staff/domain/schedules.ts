import { addScheduleDays, scheduleInstant, validateScheduleWeek } from './schedule-calendar.ts';
import {
  ScheduleError,
  type ConcreteShift,
  type SchedulingEmployee,
  type WeeklyShift,
  type WeeklyShiftInput,
} from './schedule-types.ts';

type HistoricalShift = Pick<
  ConcreteShift,
  'day' | 'working_date' | 'start' | 'end' | 'starts_at' | 'ends_at'
> &
  Partial<ConcreteShift>;

function minute(time: string): number {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new ScheduleError('SCHEDULE_SHIFT_INVALID');
  const [hour = 0, minutes = 0] = time.split(':').map(Number);
  return hour * 60 + minutes;
}
/**
 * يثبت نمط السبت إلى الجمعة دون تداخل وبحد ست عشرة ساعة؛ حد العدد يطبق على الأيام المطلوبة فقط.
 * البريك اختياري وداخل الوردية حصراً؛ التداخل مع الأسبوع المجاور يفحص بعد تحويل النسخ إلى لحظات فعلية.
 *
 * @param shifts النمط الأسبوعي
 * @param limit حد ورديات يوم البداية للفرع أو الحد الأقصى للقالب
 * @param checkedDays الأيام المتغيرة أو كل الأيام عند غيابها
 * @returns النمط مرتباً دون تعديل المدخل
 */
export function validateSchedulePattern(
  shifts: readonly WeeklyShiftInput[],
  limit: number,
  checkedDays?: readonly number[],
): WeeklyShift[] {
  const counts = new Map<number, number>();
  const ranges = shifts.map((shift) => {
    if (!Number.isInteger(shift.day) || shift.day < 0 || shift.day > 6)
      throw new ScheduleError('SCHEDULE_SHIFT_INVALID');
    counts.set(shift.day, (counts.get(shift.day) ?? 0) + 1);
    const start = minute(shift.start),
      end = minute(shift.end);
    const duration = end > start ? end - start : 1440 + end - start;
    if (duration > 960) throw new ScheduleError('SCHEDULE_SHIFT_INVALID');
    validateShiftBreak(shift);
    return { start: shift.day * 1440 + start, end: shift.day * 1440 + start + duration };
  });
  const days = [...counts]
    .filter(
      ([day, count]) => count > limit && (checkedDays === undefined || checkedDays.includes(day)),
    )
    .map(([day]) => day)
    .sort((a, b) => a - b);
  if (days.length)
    throw new ScheduleError('SCHEDULE_DAY_LIMIT_EXCEEDED', { max_shifts_per_day: limit, days });
  for (let i = 0; i < ranges.length; i++)
    for (let j = i + 1; j < ranges.length; j++) {
      const a = ranges[i],
        b = ranges[j];
      if (!a || !b) continue;
      if (a.start < b.end && b.start < a.end) throw new ScheduleError('SCHEDULE_SHIFT_OVERLAP');
    }
  return shifts
    .map((s) => ({ ...s, break_start: s.break_start ?? null, break_end: s.break_end ?? null }))
    .sort((a, b) => a.day - b.day || a.start.localeCompare(b.start));
}
/**
 * يثبت أن البريك داخل الوردية حصراً باستخدام إزاحات محلية تدعم عبور منتصف الليل.
 * غياب الطرفين مسموح؛ وجود طرف واحد أو ملامسة حدود الوردية مرفوض.
 *
 * @param shift الوردية المحلية وبريكها الاختياري
 * @returns لا قيمة؛ يرفض موضع البريك مع يوم الوردية وبدايتها
 */
export function validateShiftBreak(shift: WeeklyShiftInput): void {
  if (shift.break_start == null && shift.break_end == null) return;
  const invalid = () =>
    new ScheduleError('SCHEDULE_BREAK_INVALID', { day: shift.day, start: shift.start });
  if (shift.break_start == null || shift.break_end == null) throw invalid();
  const start = minute(shift.start);
  const offset = (time: string) => (minute(time) - start + 1440) % 1440;
  const duration = offset(shift.end);
  const from = offset(shift.break_start),
    to = offset(shift.break_end);
  if (!(0 < from && from < to && to < duration)) throw invalid();
}
/**
 * يحول البريك إلى لحظات الفرع على يوم البداية أو اليوم التالي، مع رفض فجوة أو تكرار الوقت المحلي.
 * يبقى البريك محسوباً كعمل ولا يغير حدود الوردية.
 *
 * @param workingDate يوم بداية الوردية المدني
 * @param shift الوردية وبريكها المحلي
 * @param timezone منطقة الفرع
 * @returns أوقات البريك المحلية والفعلية أو أربع قيم null عند غيابه
 */
export function materializeShiftBreak(
  workingDate: string,
  shift: WeeklyShiftInput,
  timezone: string,
) {
  if (shift.break_start == null && shift.break_end == null)
    return { break_start: null, break_end: null, break_starts_at: null, break_ends_at: null };
  validateShiftBreak(shift);
  if (shift.break_start == null || shift.break_end == null)
    throw new ScheduleError('SCHEDULE_BREAK_INVALID', { day: shift.day, start: shift.start });
  const instant = (time: string) =>
    scheduleInstant(
      time < shift.start ? addScheduleDays(workingDate, 1) : workingDate,
      time,
      timezone,
    );
  return {
    break_start: shift.break_start ?? null,
    break_end: shift.break_end ?? null,
    break_starts_at: instant(shift.break_start),
    break_ends_at: instant(shift.break_end),
  };
}
/**
 * يثبت لحظات ورديات الأسبوع والبريك في منطقة الفرع ويحفظ يوم البداية للحضور الليلي.
 * البريك داخل اللحظات الفعلية حصراً ويحسب ضمن العمل؛ حدود الوردية لا تتغير بوجوده.
 *
 * @param weekStart السبت المدني
 * @param shifts النمط المطلوب
 * @param timezone منطقة الفرع
 * @param limit حد ورديات يوم البداية للفرع
 * @param checkedDays الأيام المطلوب فحص عددها؛ الحفظ يفحص التواريخ الفعلية بعد التحويل
 * @returns الورديات المحلية ولحظاتها الفعلية
 */
export function materializeSchedule(
  weekStart: string,
  shifts: readonly WeeklyShiftInput[],
  timezone: string,
  limit: number,
  checkedDays?: readonly number[],
): ConcreteShift[] {
  validateScheduleWeek(weekStart);
  return validateSchedulePattern(shifts, limit, checkedDays).map((shift) => {
    const working_date = addScheduleDays(weekStart, shift.day);
    const endDate = shift.end <= shift.start ? addScheduleDays(working_date, 1) : working_date;
    const starts_at = scheduleInstant(working_date, shift.start, timezone);
    const ends_at = scheduleInstant(endDate, shift.end, timezone);
    if (Date.parse(ends_at) - Date.parse(starts_at) > 57_600_000)
      throw new ScheduleError('SCHEDULE_SHIFT_INVALID');
    const breaks = materializeShiftBreak(working_date, shift, timezone);
    if (
      breaks.break_starts_at !== null &&
      !(
        starts_at < breaks.break_starts_at &&
        breaks.break_ends_at !== null &&
        breaks.break_starts_at < breaks.break_ends_at &&
        breaks.break_ends_at < ends_at
      )
    )
      throw new ScheduleError('SCHEDULE_BREAK_INVALID', { day: shift.day, start: shift.start });
    return { ...shift, working_date, starts_at, ends_at, ...breaks };
  });
}
/**
 * حتى الأسبوع الفارغ يحتاج يوماً مؤهلاً في الفرع؛ الرفض لا يكشف موظفاً خارج مجال المدير.
 *
 * @param employee الموظف وتاريخ ارتباطاته
 * @param branchId الفرع المطلوب
 * @param weekStart السبت المدني
 * @returns لا قيمة؛ يرفض أسبوعاً غير مؤهل بنفس خطأ الموظف غير الموجود
 */
export function validateScheduleEmployeeWeek(
  employee: SchedulingEmployee,
  branchId: string,
  weekStart: string,
): void {
  validateScheduleWeek(weekStart);
  const eligible =
    employee.deleted_at === null &&
    Array.from({ length: 7 }, (_, day) => addScheduleDays(weekStart, day)).some(
      (date) =>
        date >= employee.hire_date &&
        (employee.contract_end === null || date <= employee.contract_end) &&
        employee.attachments.some(
          (a) => a.branch_id === branchId && a.from <= date && (a.to === null || date < a.to),
        ),
    );
  if (!eligible) throw new ScheduleError('NOT_FOUND');
}
/**
 * ارتباط الموظف بتاريخ البداية وحدوده التعاقدية تحكم أهلية كل وردية، لا الفرع الأساسي الحالي.
 *
 * @param employee الموظف وتاريخ ارتباطاته
 * @param branchId الفرع المطلوب
 * @param shifts ورديات فعلية
 * @returns لا قيمة؛ يرفض أي يوم غير مؤهل
 */
export function validateScheduleEmployee(
  employee: SchedulingEmployee,
  branchId: string,
  shifts: readonly ConcreteShift[],
): void {
  if (employee.deleted_at !== null) throw new ScheduleError('SCHEDULE_EMPLOYEE_INELIGIBLE');
  for (const shift of shifts) {
    const day = shift.working_date;
    if (
      day < employee.hire_date ||
      (employee.contract_end !== null && day > employee.contract_end) ||
      !employee.attachments.some(
        (a) => a.branch_id === branchId && a.from <= day && (a.to === null || day < a.to),
      )
    )
      throw new ScheduleError('SCHEDULE_EMPLOYEE_INELIGIBLE');
  }
}
/**
 * التقاطع يقارن اللحظات الفعلية ليمنع العمل المتزامن عبر فروع بمناطق زمنية مختلفة.
 * العدد يحسب ورديات الفرع المحفوظ فيه وحده (MB-Q1)، والتداخل يفحص كل الفروع.
 *
 * @param shifts الورديات المطلوبة
 * @param others الورديات المحفوظة خارج الأسبوع المستبدل
 * @param limit حد ورديات يوم البداية للفرع
 * @param checkedDates تواريخ البداية المتغيرة أو جميع تواريخ النسخة عند غيابها
 * @param branchId الفرع الذي يحسب عدد وردياته دون تقييد فحص التداخل
 * @returns لا قيمة؛ يرفض العدد الزائد في الأيام المفحوصة والتداخل، ويسمح بالتلامس
 */
export function validateScheduleOverlap(
  shifts: readonly ConcreteShift[],
  others: readonly (ConcreteShift & { branch_id?: string })[],
  limit: number,
  checkedDates: readonly string[] | undefined,
  branchId: string,
): void {
  const dates = [...new Set(checkedDates ?? shifts.map((s) => s.working_date))];
  const counts = new Map<string, number>();
  for (const shift of [...shifts, ...others.filter((s) => s.branch_id === branchId)])
    counts.set(shift.working_date, (counts.get(shift.working_date) ?? 0) + 1);
  const working_dates = dates.filter((day) => (counts.get(day) ?? 0) > limit).sort();
  if (working_dates.length)
    throw new ScheduleError('SCHEDULE_DAY_LIMIT_EXCEEDED', {
      max_shifts_per_day: limit,
      working_dates,
    });
  for (const a of shifts)
    for (const b of others) {
      if (a.starts_at < b.ends_at && b.starts_at < a.ends_at)
        throw new ScheduleError('SCHEDULE_SHIFT_OVERLAP');
    }
}
/**
 * تعديل الماضي يحتاج سبباً؛ القيم تقارن دون ترتيب مفاتيح JSON أو الورديات لتجنب تغيير وهمي.
 * القيم العشر تشمل البريك المحلي ولحظاته؛ إضافته أو تغييره أو إزالته تغيير، واليوم بمنطقة الفرع.
 *
 * @param before الورديات قبل التعديل
 * @param after الورديات بعد التعديل
 * @param today اليوم المحلي
 * @param reason السبب الاختياري
 * @returns لا قيمة؛ يرفض تعديل الماضي دون سبب
 */
export function requirePastScheduleReason(
  before: readonly HistoricalShift[],
  after: readonly HistoricalShift[],
  today: string,
  reason?: string,
): void {
  const past = (shifts: typeof before) =>
    JSON.stringify(
      shifts
        .filter((s) => s.working_date < today)
        .map((s) =>
          JSON.stringify([
            s.day,
            s.working_date,
            s.start,
            s.end,
            s.starts_at,
            s.ends_at,
            s.break_start ?? null,
            s.break_end ?? null,
            s.break_starts_at ?? null,
            s.break_ends_at ?? null,
          ]),
        )
        .sort(),
    );
  if (!reason?.trim() && past(before) !== past(after))
    throw new ScheduleError('SCHEDULE_PAST_REASON_REQUIRED');
}
/**
 * النسخة صفر لإنشاء أسبوع؛ كل كتابة تحمي النسخة المقروءة من تعديل مدير آخر.
 *
 * @param actual النسخة المحفوظة أو صفر
 * @param expected النسخة التي قرأها المدير
 * @returns النسخة الجديدة
 */
export function nextScheduleRevision(actual: number, expected: number): number {
  if (actual !== expected) throw new ScheduleError('SCHEDULE_REVISION_CONFLICT');
  return actual + 1;
}
