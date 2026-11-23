/**
 * الأدوار اللي بتتدى بالدعوة (IM-Q2). دور المالك مش فيهم أبداً — التعيين بيتم من غير دعوة.
 */
export const INVITABLE_ROLES = [
  'general_manager',
  'business_manager',
  'branch_manager',
  'accountant',
] as const;

export type InvitableRole = (typeof INVITABLE_ROLES)[number];

/** أنواع النطاق اللي بتتدى بيها العضوية. */
export type InvitationScopeType = 'COMPANY' | 'BUSINESS' | 'BRANCH';

/**
 * جدول الدور ← نوع النطاق اللي الدور محتاجه. مصدر واحد للحقيقة عشان تغيير اختيار المالك
 * يكون تعديل بيانات مش شغل جديد (BR-5).
 */
export const INVITABLE_SCOPE_TYPE: Readonly<Record<InvitableRole, InvitationScopeType>> = {
  general_manager: 'COMPANY',
  business_manager: 'BUSINESS',
  branch_manager: 'BRANCH',
  accountant: 'COMPANY',
};

/**
 * بيقول إن الدور ده من أدوار الدعوة ولا لأ.
 *
 * @param role كود الدور كما جاء في الطلب
 * @returns true لما يكون الدور من أدوار الدعوة
 */
export function isInvitableRole(role: string): role is InvitableRole {
  return (INVITABLE_ROLES as readonly string[]).includes(role);
}

/**
 * نوع النطاق اللي بيطلبه الدور.
 *
 * @param role كود الدور كما جاء في الطلب
 * @returns نوع النطاق، أو null لما الدور مش قابل للدعوة
 */
export function invitableScopeType(role: string): InvitationScopeType | null {
  return isInvitableRole(role) ? INVITABLE_SCOPE_TYPE[role] : null;
}

/**
 * بيحكم على الدور والنطاق اللي في الطلب: لازم الدور يكون من قائمة الدعوة، والنطاق يطابق
 * نوع النطاق اللي الدور بيطلبه. النطاق نفسه بيتفحص تاني على إنّه تابع للشركة.
 *
 * @param role كود الدور كما جاء في الطلب
 * @param scopeType نوع النطاق كما جاء في الطلب
 * @returns null لما الطلب سليم، أو كود الرفض
 */
export function invitationScopeFailure(
  role: string,
  scopeType: string,
): 'MEMBER_ROLE_NOT_INVITABLE' | null {
  const required = invitableScopeType(role);
  if (required === null) return 'MEMBER_ROLE_NOT_INVITABLE';
  return required === scopeType ? null : 'MEMBER_ROLE_NOT_INVITABLE';
}
