import type { OverrideTerms } from './permission-edit.ts';

/** كود صلاحية قراءة التقييمات (RT-Q7)؛ القاعدة بتخص المنح بتأثير ALLOW لهذا الكود بالحرف فقط. */
export const RATINGS_READ_PERMISSION = 'read:ratings:branch';

/** الأدوار النظامية الأربعة وحدها اللي فيهم خانة قراءة التقييمات (FR-B15، اختيار أبو سالم في RT-Q7). */
export const RATINGS_READ_ROLES: readonly string[] = [
  'owner',
  'general_manager',
  'business_manager',
  'branch_manager',
];

/**
 * بيرفض منح قراءة التقييمات لأي عضوية دورها الحالي مش من أدوار الإدارة الأربعة، والدور المخصص مرفوض كمان (FR-B15).
 * المنع والسحب بيمروا من غير رفض عشان إنهاء منح غلط يفضل ممكن، والقاعدة بتقرأ الدور الحالي لحظة الحفظ؛
 * إعادة فحص الدور وقت القراءة نفسها من شغل 61-2 ومش هنا.
 *
 * @param code كود الصلاحية المطلوب منحها
 * @param effect تأثير القرار؛ ALLOW هو المنح الوحيد الخاضع للقاعدة
 * @param targetRole كود الدور النظامي الحالي للعضوية المستهدفة، أو null للدور المخصص
 * @returns PERMISSION_ROLE_NOT_ELIGIBLE عند الرفض، أو null لما المنح مسموح أو القاعدة لا تنطبق
 */
export function ratingsReadGrantFailure(
  code: string,
  effect: OverrideTerms['effect'],
  targetRole: string | null,
): 'PERMISSION_ROLE_NOT_ELIGIBLE' | null {
  if (code !== RATINGS_READ_PERMISSION || effect !== 'ALLOW') return null;
  if (targetRole !== null && RATINGS_READ_ROLES.includes(targetRole)) return null;
  return 'PERMISSION_ROLE_NOT_ELIGIBLE';
}
