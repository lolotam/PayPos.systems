import type { InviteMemberInput, InvitableRole, InvitationScopeType } from '@pospay/contracts';

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

/** خيارات النطاق لدور معيّن: الأنشطة لدور النشاط، والفروع لدور الفرع، ومفيش للشركوي. */
export function scopeOptionsForRole(
  role: string,
  choices: InvitationScopeChoices,
): readonly ScopeOption[] {
  const option = INVITABLE_ROLE_OPTIONS.find((candidate) => candidate.role === role);
  if (option?.scopeType === 'BUSINESS') return choices.businesses;
  if (option?.scopeType === 'BRANCH') return choices.branches;
  return [];
}

/** التوزيع نفسه (نفس الدور ونفس النطاق) — عشان ما يتكررش ولا يتشال غلط. */
export function isSameAssignment(
  assignment: { role: string; scope: { type: string; id: string } },
  role: string,
  scopeType: string,
  scopeId: string,
): boolean {
  return (
    assignment.role === role &&
    assignment.scope.type === scopeType &&
    assignment.scope.id === scopeId
  );
}

/** اسم النطاق معروض في سطر الدور: اسم النشاط أو الفرع؛ نطاق الشركة مالوش اسم من القائمة. */
export function scopeName(
  scope: { type: InvitationScopeType; id: string },
  choices: InvitationScopeChoices,
): string | null {
  if (scope.type === 'COMPANY') return null;
  const options = scope.type === 'BUSINESS' ? choices.businesses : choices.branches;
  return options.find((option) => option.id === scope.id)?.name ?? null;
}

/**
 * الطلب اللي بيتبعت: الحقول الأساسية بس. القوائم الفاضية بتتشال عشان الطلب القديم بدور واحد
 * يفضل زي ما هو، والقوائم غير الفاضية بتتبعت زي ما هي.
 */
export function invitationPayload(values: InviteMemberInput): InviteMemberInput {
  const additionalRoles = values.additional_roles ?? [];
  const permissionOverrides = values.permission_overrides ?? [];
  return {
    email: values.email,
    name: values.name,
    role: values.role,
    scope: values.scope,
    email_confirmed: values.email_confirmed,
    ...(additionalRoles.length === 0 ? {} : { additional_roles: additionalRoles }),
    ...(permissionOverrides.length === 0 ? {} : { permission_overrides: permissionOverrides }),
  };
}
