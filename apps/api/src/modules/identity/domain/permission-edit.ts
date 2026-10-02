import { evaluateAccess, type AccessGrant, type AccessTarget, type ScopeType } from './access.ts';

/** العضوية المستهدفة، بدون أي بيانات دخول حساسة. */
export interface EditableMembership {
  readonly id: string;
  readonly scopeType: ScopeType;
  readonly scopeId: string;
  readonly startsAt: Date;
  readonly endsAt: Date | null;
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
}

/**
 * بيعلن جاهزية سياسة التفويض؛ غياب القرار يمنع تعديل الصلاحيات بدل اختراع سلطة جديدة.
 *
 * @returns false لحد قرار المالك عن الصلاحيات القابلة للتعديل
 */
export function permissionEditingEnabled(): boolean {
  // TODO(spec) EDIT-POLICY: مصفوفة الصلاحيات الحساسة المشار إليها في PRD §3.2 غير موجودة؛ يلزم قرار التفويض وحماية المالك والنفس.
  return false;
}

/**
 * بيتحقق من صلاحية المدير والكتالوج والنطاق والمدة قبل أي كتابة؛ DENY يظل حاسمًا.
 *
 * @param terms بيانات الاستثناء المطلوبة
 * @param context العضوية والصلاحيات والهدف الموثوق والوقت المحقون
 * @returns سبب الرفض، أو null عند السماح
 */
export function permissionEditFailure(
  terms: OverrideTerms,
  context: PermissionEditContext,
): 'FORBIDDEN' | 'VALIDATION_FAILED' | 'PERMISSION_POLICY_UNRESOLVED' | null {
  const { membership, target, companyId, now } = context;
  if (!evaluateAccess(context.grants, 'manage:memberships:company', { companyId }))
    return 'FORBIDDEN';
  if (membership === null || target === null) return 'FORBIDDEN';
  if (
    !context.catalog.includes(terms.permission_code) ||
    terms.permission_code.endsWith(':platform')
  )
    return 'FORBIDDEN';
  if (membership.startsAt > now || (membership.endsAt !== null && membership.endsAt <= now))
    return 'FORBIDDEN';
  if (terms.scope_type === 'COMPANY' && terms.scope_id !== companyId) return 'FORBIDDEN';
  if (terms.expires_at !== null && new Date(terms.expires_at) <= now) return 'VALIDATION_FAILED';
  if (!permissionEditingEnabled()) return 'PERMISSION_POLICY_UNRESOLVED';
  return null;
}
