import type { AccessGrant } from './access.ts';

/**
 * بيحفظ سلطة المالك الإداريّة حتى لو فيه DENY قديم على عضوية شقيقة؛ دخول الموظفين له قرار مستقل ADR-0019.
 *
 * @param grants المنح السارية مع مصادرها ونطاقاتها
 * @param activeOwner هل الشخص يحمل أي عضوية مالك سارية داخل الشركة المؤكدة
 * @returns المنح للتقييم بدون DENY يقلل سلطة المالك، والتاريخ المخزن لا يتغير
 */
export function protectOwnerAccess<T extends AccessGrant>(
  grants: readonly T[],
  activeOwner: boolean,
): readonly T[] {
  if (!activeOwner) return grants;
  return grants.filter((g) => g.effect !== 'DENY' || g.permission === 'login:staff:branch');
}
