import { validateScheduleWeek } from './schedule-calendar.ts';
import { ScheduleError, type ScheduleRecord, type TemplateRecord } from './schedule-types.ts';

/**
 * الأرشفة تمنع التعديل والتطبيق دون المساس بالنسخ الموجودة.
 *
 * @param template القالب المحفوظ
 * @returns لا قيمة؛ يرفض القالب المؤرشف
 */
export function requireActiveTemplate(template: TemplateRecord): void {
  if (template.archived_at !== null) throw new ScheduleError('SCHEDULE_TEMPLATE_ARCHIVED');
}
/**
 * كل أسبوع صريح وفريد ويبدأ السبت؛ التطبيق محدود باثني عشر أسبوعاً لتبقى النسخ قابلة للمراجعة.
 *
 * @param weeks الأسابيع المختارة
 * @returns لا قيمة؛ يرفض أهدافاً غير صالحة
 */
export function validateTemplateWeeks(weeks: readonly string[]): void {
  if (weeks.length < 1 || weeks.length > 12 || new Set(weeks).size !== weeks.length)
    throw new ScheduleError('SCHEDULE_WEEK_INVALID');
  weeks.forEach(validateScheduleWeek);
}
/**
 * يحصر الكتابة المتزامنة في عشرين نسخة أسبوع؛ الدفعات الأكبر تحتاج مسار worker.
 *
 * @param employeeCount عدد الموظفين المختارين
 * @param weekCount عدد الأسابيع المختارة
 * @returns لا قيمة؛ يرفض تجاوز السقف التقني المؤقت
 */
export function validateTemplateBatch(employeeCount: number, weekCount: number): void {
  // TODO(spec) SC-Q3: تأكيد سقف عشرين نسخة أسبوع مؤقتاً إلى أن يجهز تطبيق worker.
  if (employeeCount * weekCount > 20) throw new ScheduleError('SCHEDULE_APPLY_BATCH_TOO_LARGE');
}
/**
 * الاستبدال اختيار صريح بسبب؛ الرفض يسرد التعارضات في المجال الذي أذن به المدير فقط.
 *
 * @param conflicts الجداول الموجودة في الأهداف المتحقق منها
 * @param replace اختيار الاستبدال
 * @param reason سبب الاستبدال
 * @returns لا قيمة؛ يرفض الطلب غير الصريح
 */
export function requireTemplateReplacement(
  conflicts: readonly ScheduleRecord[],
  replace: boolean,
  reason?: string,
): void {
  // TODO(spec) SC-Q1: تأكيد سياسة رفض التعارضات مع استبدال صريح وسبب بدلاً من دمج الورديات.
  if (conflicts.length > 0 && !replace)
    throw new ScheduleError('SCHEDULE_APPLY_CONFLICT', {
      conflicts: conflicts.map((s) => ({
        employee_id: s.employee_id,
        branch_id: s.branch_id,
        week_start: s.week_start,
      })),
    });
  if (replace && !reason?.trim()) throw new ScheduleError('SCHEDULE_REPLACE_REASON_REQUIRED');
}
