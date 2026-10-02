import { evaluateAccess, type AccessGrant, type AccessTarget, type ScopeType } from './access.ts';

/** العضوية المستهدفة، بدون أي بيانات دخول حساسة. */
export interface EditableMembership {
  readonly id: string;
  readonly scopeType: ScopeType;
  readonly scopeId: string;
  readonly startsAt: Date;
  readonly endsAt: Date | null;
  readonly userId: string | null;
  readonly roleCode: string;
}
/** بيانات طلب الاستثناء بعد التحقق من عقد الإدخال. */
export interface OverrideTerms {
  readonly permission_code: string;
  readonly effect: 'ALLOW' | 'DENY';
  readonly scope_type: ScopeType;
  readonly scope_id: string;
  readonly reason: string;
  readonly expires_at: string | null;
}
/** بيانات القرار كلها من الشركة المؤكدة وقارئ داخل المعاملة. */
export interface PermissionEditContext {
  readonly membership: EditableMembership | null;
  readonly catalog: readonly string[];
  readonly target: AccessTarget | null;
  readonly grants: readonly AccessGrant[];
  readonly companyId: string;
  readonly now: Date;
  readonly editorUserId: string;
  readonly descendantTargets: readonly AccessTarget[];
}

/**
 * بيتحقق من صلاحية المدير والكتالوج والنطاق والمدة قبل أي كتابة؛ DENY يظل حاسمًا.
 *
 * @param terms بيانات الاستثناء المطلوبة
 * @param context العضوية والصلاحيات والهدف الموثوق والوقت المحقون
 * @param operation الحفظ أو السحب؛ سحب DENY من المالك لا يقلل صلاحياته
 * @returns سبب الرفض، أو null عند السماح
 */
export function permissionEditFailure(
  terms: OverrideTerms,
  context: PermissionEditContext,
  operation: 'SAVE' | 'REVOKE' = 'SAVE',
):
  | 'FORBIDDEN'
  | 'VALIDATION_FAILED'
  | 'PERMISSION_NOT_HELD'
  | 'PERMISSION_SELF_EDIT'
  | 'PERMISSION_OWNER_PROTECTED'
  | 'PERMISSION_SCOPE_OUTSIDE_REACH'
  | null {
  const { membership, target, companyId, now } = context;
  if (!evaluateAccess(context.grants, 'manage:memberships:company', { companyId }))
    return 'FORBIDDEN';
  if (membership === null || target === null) return 'FORBIDDEN';
  if (target.companyId !== companyId) return 'FORBIDDEN';
  if (membership.userId === context.editorUserId) return 'PERMISSION_SELF_EDIT';
  if (
    !context.catalog.includes(terms.permission_code) ||
    terms.permission_code.endsWith(':platform')
  )
    return 'FORBIDDEN';
  if (membership.startsAt > now || (membership.endsAt !== null && membership.endsAt <= now))
    return 'FORBIDDEN';
  if (terms.scope_type === 'COMPANY' && terms.scope_id !== companyId) return 'FORBIDDEN';
  if (operation === 'SAVE' && terms.expires_at !== null && new Date(terms.expires_at) <= now)
    return 'VALIDATION_FAILED';
  if (operation === 'SAVE' && membership.roleCode === 'owner' && terms.effect === 'DENY')
    return 'PERMISSION_OWNER_PROTECTED';
  if (!evaluateAccess(context.grants, terms.permission_code, target)) {
    const allowedElsewhere = context.grants.some(
      (g) => g.permission === terms.permission_code && g.effect === 'ALLOW',
    );
    const deniedHere = context.grants.some(
      (g) =>
        g.permission === terms.permission_code &&
        g.effect === 'DENY' &&
        evaluateAccess([{ ...g, effect: 'ALLOW' }], terms.permission_code, target),
    );
    return allowedElsewhere && !deniedHere
      ? 'PERMISSION_SCOPE_OUTSIDE_REACH'
      : 'PERMISSION_NOT_HELD';
  }
  if (
    context.descendantTargets.some(
      (child) => !evaluateAccess(context.grants, terms.permission_code, child),
    )
  )
    return 'PERMISSION_NOT_HELD';
  return null;
}
