import { SessionError } from './session-error.ts';
import type { SessionEmployee } from './session-types.ts';

/**
 * يوزع النسب المتساوية ويعطي باقي وحدات الأساس للأولى في المدخل حسب SS-Q7.
 *
 * @param count عدد الموظفات من واحدة إلى أربع
 * @returns نسب موجبة مجموعها ١٠٠٠٠ بترتيب المدخل
 */
export function equalShares(count: number): number[] {
  if (!Number.isInteger(count) || count < 1 || count > 4) throw new SessionError('SESSION_PERFORMER_SHARES_INVALID');
  const share = Math.floor(10000 / count);
  return Array.from({ length: count }, (_, i) => share + (i === 0 ? 10000 % count : 0));
}
/**
 * يرفض العدد والتكرار حسب SS-20 قبل قراءة الموظفات، حتى لا يتحول خطأ المدخل إلى فشل تخزين.
 * حد الأربع لكل بند يبقي دفعة الطلب ذي العشرين بنداً ضمن حد قارئ الموظفات.
 *
 * @param performers معرفات موظفات البند دون الحاجة إلى حقائق من التخزين
 * @param input_index موضع البند لتوجيه تصحيح الطلب المرفوض
 * @returns لا شيء؛ العدد خارج واحدة إلى أربع أو المعرف المكرر يرفض الطلب كله
 */
export function validatePerformerCardinality(performers: readonly { employee_id: string }[], input_index: number): void {
  if (performers.length < 1 || performers.length > 4 || new Set(performers.map((p) => p.employee_id)).size !== performers.length)
    throw new SessionError('SESSION_PERFORMER_SHARES_INVALID', { input_index });
}
/**
 * يرفض عدد الموظفات أو نسبهن المخالفة لـ SS-20 مع موضع البند؛ النسب غير المتساوية مسموحة أولياً.
 *
 * @param performers موظفات المدخل ونسبهن الاختيارية
 * @param input_index موضع البند في الطلب لعرض التصحيح عند رفض الزيارة كلها
 * @returns النسب المتحقق منها بترتيب المدخل
 */
export function validateShares(performers: readonly { employee_id: string; share_bps?: number | undefined }[], input_index: number): number[] {
  validatePerformerCardinality(performers, input_index);
  const defaults = equalShares(performers.length);
  if (performers.every((p) => p.share_bps === undefined)) return defaults;
  const shares = performers.map((p) => p.share_bps ?? 0);
  if (shares.some((s) => !Number.isInteger(s) || s < 1 || s > 10000) || shares.reduce((a, b) => a + b, 0) !== 10000)
    throw new SessionError('SESSION_PERFORMER_SHARES_INVALID', { input_index });
  return shares;
}
/**
 * التنبيه لا يغير السعر أو النسب ولا يمنع تسجيل خدمة تمت فعلاً.
 *
 * @param employee حقائق الحضور والإجازة من staff
 * @returns الرايتان المستقلتان اللتان قد تجتمعان
 */
export function performerWarnings(employee: Pick<SessionEmployee, 'clocked_in' | 'approved_leave'>) {
  return { not_clocked_in_warning: !employee.clocked_in, approved_leave_warning: employee.approved_leave };
}
/**
 * يمنع تسجيل الأداء الذاتي حتى للمالك؛ الرابط المحفوظ فقط يثبت الهوية.
 *
 * @param userId المستخدم الذي يسجل الآن
 * @param employees حقائق روابط المستخدمين؛ الرابط الغائب لا يخمّن
 * @returns لا شيء؛ أي رابط مطابق يرفض الطلب كله
 */
export function validateRecorderPerformers(userId: string, employees: readonly Pick<SessionEmployee, 'user_id'>[]): void {
  if (employees.some((e) => e.user_id === userId)) throw new SessionError('SESSION_PERFORMER_SELF_FORBIDDEN');
}
