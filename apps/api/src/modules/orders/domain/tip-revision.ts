import { SessionError } from './session-error.ts';

/**
 * يرفض الطلب إذا لم تطابق النسخة المتوقعة النسخة المحفوظة.
 * تُفحص النسخة قبل قواعد المجموعة، فطلبان متطابقان متزامنان يخسر الثاني بتعارض النسخة لا بغياب التغيير.
 *
 * @param current النسخة المحفوظة الآن، وصفر يعني أنه لا مراجعة بعد
 * @param expected النسخة التي بنت عليها الطالبة طلبها
 * @returns لا شيء؛ النسخة الأقدم ترفض وتفاصيلها تحمل current_revision فقط
 */
export function assertTipRevision(current: number, expected: number): void {
  if (expected !== current) {
    throw new SessionError('TIP_REVISION_CONFLICT', { current_revision: current });
  }
}

/**
 * يحسب رقم المراجعة التالية ورابطها بالسابقة لسلسلة لا تستخدم max()+1.
 * أول مراجعة رقمها 1 وبلا سابقة، وكل ما بعدها يزيد واحداً ويشير إلى الحالية.
 *
 * @param current رقم المراجعة المحفوظة، وصفر قبل أي بقشيش
 * @returns رقم المراجعة الجديدة والسابقة التي تشير إليها، أو null في أول مراجعة
 */
export function nextTipRevision(current: number): {
  revision: number;
  previous_revision: number | null;
} {
  if (current === 0) return { revision: 1, previous_revision: null };
  return { revision: current + 1, previous_revision: current };
}

/**
 * يرفض حفظ مراجعة لا تغيّر المجموعة، حتى لا تُحرق نسخة وتُكتب أثر بلا فرق.
 * تُستدعى بعد فحص النسخة، فغياب التغيير لا يخفي تعارضاً أسبق.
 *
 * @param changedAnything هل اختلفت المجموعة المطلوبة عن الحالية
 * @returns لا شيء؛ المجموعة المطابقة ترفض بـ TIP_NO_CHANGE
 */
export function assertTipChange(changedAnything: boolean): void {
  if (!changedAnything) throw new SessionError('TIP_NO_CHANGE');
}
