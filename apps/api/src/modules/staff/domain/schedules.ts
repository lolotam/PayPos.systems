import { addScheduleDays, scheduleInstant, validateScheduleWeek } from './schedule-calendar.ts';
import {
  ScheduleError,
  type ConcreteShift,
  type SchedulingEmployee,
  type WeeklyShift,
} from './schedule-types.ts';

import { changedScheduleDays, DEFAULT_MAX_SHIFTS_PER_DAY } from './schedule-settings.ts';

function minute(time: string): number {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new ScheduleError('SCHEDULE_SHIFT_INVALID');
  const [hour = 0, minutes = 0] = time.split(':').map(Number);
  return hour * 60 + minutes;
}
/**
 * يثبت نمط السبت إلى الجمعة دون تداخل وبحد ست عشرة ساعة؛ حد العدد يطبق على الأيام المطلوبة فقط.
 * التداخل مع الأسبوع المجاور يفحص بعد تحويل النسخ إلى لحظات فعلية.
 *
 * @param shifts النمط الأسبوعي
 * @param limit حد ورديات يوم البداية للنشاط
 * @param checkedDays الأيام المتغيرة أو كل الأيام عند غيابها
 * @returns النمط مرتباً دون تعديل المدخل
 */
export function validateSchedulePattern(
  shifts: readonly WeeklyShift[],
  limit = DEFAULT_MAX_SHIFTS_PER_DAY,
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
    return { start: shift.day * 1440 + start, end: shift.day * 1440 + start + duration };
  });
  const days = [...counts]
    .filter(([day, count]) => count > limit && (checkedDays === undefined || checkedDays.includes(day)))
    .map(([day]) => day).sort((a, b) => a - b);
  if (days.length)
    throw new ScheduleError('SCHEDULE_DAY_LIMIT_EXCEEDED', { max_shifts_per_day: limit, days });
  for (let i = 0; i < ranges.length; i++)
    for (let j = i + 1; j < ranges.length; j++) {
      const a = ranges[i],
        b = ranges[j];
      if (!a || !b) continue;
      if (a.start < b.end && b.start < a.end) throw new ScheduleError('SCHEDULE_SHIFT_OVERLAP');
    }
  return [...shifts].sort((a, b) => a.day - b.day || a.start.localeCompare(b.start));
}
/**
 * يثبت لحظات ورديات الأسبوع في منطقة الفرع ويحفظ يوم البداية للحضور الليلي.
 *
 * @param weekStart السبت المدني
 * @param shifts النمط المطلوب
 * @param timezone منطقة الفرع
 * @param limit حد ورديات يوم البداية للنشاط
 * @param checkedDays الأيام المطلوب فحص عددها؛ الحفظ يفحص التواريخ الفعلية بعد التحويل
 * @returns الورديات المحلية ولحظاتها الفعلية
 */
export function materializeSchedule(
  weekStart: string,
  shifts: readonly WeeklyShift[],
  timezone: string,
  limit = DEFAULT_MAX_SHIFTS_PER_DAY,
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
    return { ...shift, working_date, starts_at, ends_at };
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
 *
 * @param shifts الورديات المطلوبة
 * @param others الورديات المحفوظة خارج الأسبوع المستبدل
 * @param limit حد ورديات يوم البداية للنشاط
 * @param checkedDates تواريخ البداية المتغيرة أو جميع تواريخ النسخة عند غيابها
 * @returns لا قيمة؛ يرفض العدد الزائد في الأيام المفحوصة والتداخل، ويسمح بالتلامس
 */
export function validateScheduleOverlap(
  shifts: readonly ConcreteShift[],
  others: readonly ConcreteShift[],
  limit = DEFAULT_MAX_SHIFTS_PER_DAY,
  checkedDates?: readonly string[],
): void {
  const dates = [...new Set(checkedDates ?? shifts.map((s) => s.working_date))];
  const counts = new Map<string, number>();
  for (const shift of [...shifts, ...others])
    counts.set(shift.working_date, (counts.get(shift.working_date) ?? 0) + 1);
  const working_dates = dates.filter((day) => (counts.get(day) ?? 0) > limit).sort();
  if (working_dates.length)
    throw new ScheduleError('SCHEDULE_DAY_LIMIT_EXCEEDED', { max_shifts_per_day: limit, working_dates });
  for (const a of shifts)
    for (const b of others) {
      if (a.starts_at < b.ends_at && b.starts_at < a.ends_at)
        throw new ScheduleError('SCHEDULE_SHIFT_OVERLAP');
    }
}
/**
 * تعديل الماضي يحتاج سبباً؛ القيم تقارن دون ترتيب مفاتيح JSON أو الورديات لتجنب تغيير وهمي.
 * إزالة وردية قديمة تغيير أيضاً، واليوم محسوب في منطقة الفرع.
 *
 * @param before الورديات قبل التعديل
 * @param after الورديات بعد التعديل
 * @param today اليوم المحلي
 * @param reason السبب الاختياري
 * @returns لا قيمة؛ يرفض تعديل الماضي دون سبب
 */
export function requirePastScheduleReason(
  before: readonly ConcreteShift[],
  after: readonly ConcreteShift[],
  today: string,
  reason?: string,
): void {
  if (!reason?.trim() && changedScheduleDays(before, after).some((date) => date < today))
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
