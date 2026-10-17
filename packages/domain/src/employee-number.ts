/** أكبر رقم وظيفي مسموح (قرار المالك EN-Q8: رقم صحيح من 1 إلى 999999). */
export const EMPLOYEE_NUMBER_MAX = 999999;

/**
 * يجد أول رقم وظيفي غير مستخدم عند العدّاد أو بعده.
 * القاعدة: التخطي يشمل كل رقم مستخدم (EN-Q6)، والرقم المكتوب بالإيد لا يحرّك العدّاد.
 *
 * @param counter أول رقم يُفحص (يبدأ من 1 أو من رقم البداية الذي اختاره المالك)
 * @param usedAtOrAbove الأرقام المستخدمة فعلاً داخل الشركة، من العدّاد فما فوق، وليس شرطاً أن تكون مرتبة
 * @returns أول رقم حر، أو null إذا كان العدّاد خارج النطاق أو لم يبق رقم حر حتى 999999
 */
export function firstFreeEmployeeNumber(
  counter: number,
  usedAtOrAbove: readonly number[],
): number | null {
  if (!Number.isInteger(counter) || counter < 1) return null;
  const used = new Set(usedAtOrAbove);
  for (let candidate = counter; candidate <= EMPLOYEE_NUMBER_MAX; candidate++) {
    if (!used.has(candidate)) return candidate;
  }
  return null;
}
