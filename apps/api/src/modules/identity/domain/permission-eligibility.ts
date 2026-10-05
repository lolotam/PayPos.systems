import type { OverrideTerms, PermissionEditContext } from './permission-edit.ts';

/**
 * ❌ لا يقبل ALLOW حتى لو المدير يملك الإذن؛ الأدوار المخصصة تحتفظ بسياسة PR 7.
 *
 * @param terms قرار السماح الجديد
 * @param context هوية الدور وأهلية المرجع ونطاق العضوية المؤكد بعد القفل
 * @returns رفض الخانة أو النطاق، أو null للخانة الافتراضية أو الاختيارية أو الدور المخصص
 */
export function personalAllowFailure(terms: OverrideTerms, context: PermissionEditContext) {
  const member = context.membership;
  if (member === null || terms.effect !== 'ALLOW') return null;
  if (
    member.allowedPermissions !== null &&
    !member.allowedPermissions.includes(terms.permission_code)
  )
    return 'PERMISSION_ROLE_FORBIDDEN' as const;
  if (
    member.systemRoleCode === 'business_manager' &&
    [
      'read:memberships:business',
      'manage:memberships:business',
      'create:customers:business',
      'manage:discount-limits:business',
      'read:passkeys:branch',
      'unbind:passkeys:branch',
    ].includes(terms.permission_code) &&
    (member.scopeType !== 'BUSINESS' ||
      context.membershipTarget?.businessId === undefined ||
      context.target?.businessId !== context.membershipTarget.businessId)
  )
    return 'PERMISSION_SCOPE_OUTSIDE_REACH' as const;
  if (
    ['branch_manager', 'cashier'].includes(member.systemRoleCode ?? '') &&
    (terms.permission_code === 'create:customers:branch' ||
      (member.systemRoleCode === 'branch_manager' &&
        ['read:passkeys:branch', 'unbind:passkeys:branch'].includes(terms.permission_code))) &&
    (member.scopeType !== 'BRANCH' ||
      terms.scope_type !== 'BRANCH' ||
      terms.scope_id !== member.scopeId)
  )
    return 'PERMISSION_SCOPE_OUTSIDE_REACH' as const;
  return null;
}
