import type { WeekdayDefaultShift } from '@pospay/domain';
import { validateSchedulePattern } from './schedules.ts';
import type { WeeklyShiftInput } from './schedule-types.ts';

/**
 * فترة ارتباط الموظفة بفرع بتواريخ الفرع المحلية؛ البداية داخلة والنهاية خارجة، و`to` الفارغ يعني ارتباطاً مفتوحاً.
 * الحفظ يُقبل فقط لفرع مرتبطة به اليوم (EMPLOYEE_BRANCH_NOT_LINKED).
 */
export type DefaultShiftLink = { branch_id: string; from: string; to: string | null };
/** رفض عام لحفظ الدوام الافتراضي، يترجمه محول HTTP لكود الخطأ دون كشف بيانات موظفة أو فرع آخر. */
export class EmployeeDefaultShiftsError extends Error {
  /** يحمل كود رفض الدوام إلى محول HTTP دون تفاصيل موظفة أو فرع.
   *
   * @param code كود الرفض العام
   */
  constructor(readonly code: 'EMPLOYEE_BRANCH_NOT_LINKED' | 'NOT_FOUND' | 'FORBIDDEN' | 'FEATURE_DISABLED' | 'TRANSACTION_RETRY_REQUIRED') {
    super(code);
  }
}
/**
 * يثبت دواماً واحداً لكل يوم بنفس قواعد الجدول والبريك حتى لا تختلف الشاشة عن الجدول.
 *
 * @param shifts الدوام الأسبوعي المحلي للفرع
 * @returns الدوام مرتباً بعد التحقق
 */
export function validateDefaultShifts(shifts: readonly WeeklyShiftInput[]) {
  return validateSchedulePattern(shifts, 1);
}
/**
 * يقارن الدوام دون ترتيب الإدخال، وغياب البريك يساوي القيمة الفارغة لمنع تدقيق تغيير وهمي.
 *
 * @param before الدوام المحفوظ
 * @param after الدوام المطلوب
 * @returns تطابق المجموعتين
 */
export function sameDefaultShifts(before: readonly WeekdayDefaultShift[], after: readonly WeekdayDefaultShift[]): boolean {
  const canonical = (shifts: readonly WeekdayDefaultShift[]) => JSON.stringify(shifts.map((s) =>
    [s.day, s.start, s.end, s.break_start ?? null, s.break_end ?? null]).sort((a, b) => Number(a[0]) - Number(b[0])));
  return canonical(before) === canonical(after);
}
/**
 * يثبت ارتباط الموظفة بالفرع في اليوم المحلي؛ البداية داخلة والنهاية خارجة من الفترة.
 *
 * @param links فترات ارتباط الموظفة
 * @param branchId الفرع المطلوب
 * @param date اليوم المحلي للفرع
 * @returns وجود ارتباط يشمل اليوم
 */
export function linkedOn(links: readonly DefaultShiftLink[], branchId: string, date: string): boolean {
  return links.some((link) => link.branch_id === branchId && link.from <= date && (link.to === null || date < link.to));
}
