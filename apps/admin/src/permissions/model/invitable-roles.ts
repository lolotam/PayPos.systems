import type { InvitableRole, InvitationScopeType } from '@pospay/contracts';

/** خيارات النطاق المعروضة: أسماء الأنشطة والفروع من الـ workspace. */
export interface ScopeOption {
  readonly id: string;
  readonly name: string;
}

/** قوائم النطاق المتاحة للنموذج: أنشطة وفروع الشركة. */
export interface InvitationScopeChoices {
  readonly businesses: readonly ScopeOption[];
  readonly branches: readonly ScopeOption[];
}

/**
 * خيارات الدور اللي بتتدى بالدعوة (IM-Q2) مع نوع النطاق اللي الدور بيطلعه — عرض بس؛
 * الحكم النهائي على الدور والنطاق في السيرفر (422 لغير المطابق).
 */
export interface InvitableRoleOption {
  readonly role: InvitableRole;
  readonly scopeType: InvitationScopeType;
  readonly labelKey:
    | 'invitations.roleGeneralManager'
    | 'invitations.roleBusinessManager'
    | 'invitations.roleBranchManager'
    | 'invitations.roleAccountant';
}

export const INVITABLE_ROLE_OPTIONS: readonly InvitableRoleOption[] = [
  { role: 'general_manager', scopeType: 'COMPANY', labelKey: 'invitations.roleGeneralManager' },
  { role: 'business_manager', scopeType: 'BUSINESS', labelKey: 'invitations.roleBusinessManager' },
  { role: 'branch_manager', scopeType: 'BRANCH', labelKey: 'invitations.roleBranchManager' },
  { role: 'accountant', scopeType: 'COMPANY', labelKey: 'invitations.roleAccountant' },
];

/**
 * النطاق الكامل اللي الدور بيبدأ بيه في النموذج: نوعه من الدور، ومعرّفه معرّف الشركة للأدوار اللي
 * نطاقها الشركة أو فاضي لحد ما المالك يختار نشاط أو فرع. دور مش في القائمة بيرجع نطاق الشركة.
 */
export function scopeForRole(
  role: string,
  companyId: string,
): { type: InvitationScopeType; id: string } {
  const option = INVITABLE_ROLE_OPTIONS.find((candidate) => candidate.role === role);
  const type = option?.scopeType ?? 'COMPANY';
  return { type, id: type === 'COMPANY' ? companyId : '' };
}
