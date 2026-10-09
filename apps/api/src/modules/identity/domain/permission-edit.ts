import { evaluateAccess, type AccessGrant, type AccessTarget, type ScopeType } from './access.ts';
import { personalAllowFailure } from './permission-eligibility.ts';

/** قرار spec 039 يحصر منح الوثائق في المالك؛ القائمة الصافية تمنع اعتماد الدومين على قاعدة البيانات. */
const OWNER_GRANTED_PERMISSIONS: readonly string[] = [
  'read:files:business',
  'manage:files:business',
  'manage:document-types:company',
];

/** العضوية المستهدفة، بدون أي بيانات دخول حساسة. */
export interface EditableMembership {
  readonly id: string;
  readonly scopeType: ScopeType;
  readonly scopeId: string;
  readonly startsAt: Date;
  readonly endsAt: Date | null;
  readonly userId: string | null;
  readonly employeeId: string | null;
  readonly roleCode: string;
  readonly systemRoleCode: string | null;
  readonly allowedPermissions: readonly string[] | null;
  readonly isCompanyOwner: boolean;
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
  readonly holderMemberships: readonly EditableMembership[];
  readonly catalog: readonly string[];
  readonly target: AccessTarget | null;
  readonly grants: readonly AccessGrant[];
  readonly companyId: string;
  readonly now: Date;
  readonly editorUserId: string;
  readonly editorIsCompanyOwner: boolean;
  readonly descendantTargets: readonly AccessTarget[];
  readonly membershipTarget?: AccessTarget | null;
  readonly managementBusinessId?: string | undefined;
}

/**
 * بيحصر إدارة النشاط في عضوياته وقراراته بعد تحميل النطاق الحقيقي؛ إذن النشاط لا يفتح إدارة الشركة.
 *
 * @param context لقطة المدير والهدف داخل المعاملة
 * @returns هل سلطة الإدارة تغطي العضوية والقرار معاً
 */
export function membershipManagementAllowed(context: PermissionEditContext): boolean {
  const { companyId, managementBusinessId, membershipTarget, target } = context;
  if (managementBusinessId === undefined)
    return evaluateAccess(context.grants, 'manage:memberships:company', { companyId });
  if (
    membershipTarget?.businessId !== managementBusinessId ||
    target?.businessId !== managementBusinessId
  )
    return false;
  return [membershipTarget, target, ...context.descendantTargets].every((scope) =>
    evaluateAccess(context.grants, 'manage:memberships:business', scope),
  );
}

/**
 * بيحمي الشخص لو أي عضوية سارية له في نفس الشركة تحمل دور المالك؛ اختلاف العضوية لا يلغي الحماية.
 *
 * @param context لقطة عضويات صاحب الهدف ووقت القرار بعد القفل داخل الشركة المؤكدة
 * @returns هل صاحب الهدف مالك نشط مهما كان دور العضوية المستهدفة
 */
export function permissionHolderIsOwner(context: PermissionEditContext): boolean {
  const holder = context.membership;
  if (holder === null) return false;
  return [holder, ...context.holderMemberships].some(
    (candidate) =>
      ((holder.userId !== null && candidate.userId === holder.userId) ||
        (holder.employeeId !== null && candidate.employeeId === holder.employeeId)) &&
      candidate.isCompanyOwner &&
      candidate.scopeType === 'COMPANY' &&
      candidate.scopeId === context.companyId &&
      candidate.startsAt <= context.now &&
      (candidate.endsAt === null || candidate.endsAt > context.now),
  );
}

/**
 * بيطبق سياسة PR 7 لامتلاك الإذن عبر النطاق كله؛ DENY في أي فرع تابع يمنع تعديل سلطة النشاط.
 * مشاركة القاعدة تحافظ على نفس سياسة الحد الشخصي وافتراضي النشاط بدون نسختين مختلفتين.
 *
 * @param grants الصلاحيات السارية
 * @param permission الإذن المراد تعديله
 * @param target النطاق المؤكد
 * @param descendants النطاقات التابعة التي سيؤثر فيها التعديل
 * @returns سبب الرفض أو null لو كل النطاق مغطى
 */
export function permissionPossessionFailure(
  grants: readonly AccessGrant[],
  permission: string,
  target: AccessTarget,
  descendants: readonly AccessTarget[],
): 'PERMISSION_NOT_HELD' | 'PERMISSION_SCOPE_OUTSIDE_REACH' | null {
  if (!evaluateAccess(grants, permission, target)) {
    const elsewhere = grants.some((g) => g.permission === permission && g.effect === 'ALLOW');
    const denied = grants.some(
      (g) =>
        g.permission === permission &&
        g.effect === 'DENY' &&
        evaluateAccess([{ ...g, effect: 'ALLOW' }], permission, target),
    );
    return elsewhere && !denied ? 'PERMISSION_SCOPE_OUTSIDE_REACH' : 'PERMISSION_NOT_HELD';
  }
  return descendants.some((child) => !evaluateAccess(grants, permission, child))
    ? 'PERMISSION_NOT_HELD'
    : null;
}

/**
 * بيتحقق من السلطة والنطاق والمدة؛ تفويض كودي إدارة النشاط لمديره لا يتجاوز نشاط عضويته.
 * منع تعديل الذات وحماية المالك يتبعان الشخص لا رقم العضوية؛ منح ALLOW للوثائق محصور في المالك النشط.
 *
 * @param terms بيانات الاستثناء المطلوبة
 * @param context العضوية والصلاحيات والهدف الموثوق والوقت المحقون
 * @param operation حفظ الاستثناء أو سحبه، أو فحص معامل خصم لا يمنح أي إذن
 * @returns سبب الرفض، أو null عند السماح
 */
export function permissionEditFailure(
  terms: OverrideTerms,
  context: PermissionEditContext,
  operation: 'SAVE' | 'REVOKE' | 'CHECK' = 'SAVE',
):
  | 'FORBIDDEN'
  | 'VALIDATION_FAILED'
  | 'PERMISSION_NOT_HELD'
  | 'PERMISSION_SELF_EDIT'
  | 'PERMISSION_OWNER_PROTECTED'
  | 'PERMISSION_SCOPE_OUTSIDE_REACH'
  | 'PERMISSION_ROLE_FORBIDDEN'
  | 'PERMISSION_OWNER_ONLY'
  | null {
  const { membership, target, companyId, now } = context;
  if (!membershipManagementAllowed(context)) return 'FORBIDDEN';
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
  if (operation === 'SAVE' && permissionHolderIsOwner(context) && terms.effect === 'DENY')
    return 'PERMISSION_OWNER_PROTECTED';
  if (
    operation === 'SAVE' &&
    terms.effect === 'ALLOW' &&
    OWNER_GRANTED_PERMISSIONS.includes(terms.permission_code) &&
    !context.editorIsCompanyOwner
  )
    return 'PERMISSION_OWNER_ONLY';
  const eligibility = operation === 'SAVE' ? personalAllowFailure(terms, context) : null;
  if (eligibility !== null) return eligibility;
  return permissionPossessionFailure(
    context.grants,
    terms.permission_code,
    target,
    context.descendantTargets,
  );
}
