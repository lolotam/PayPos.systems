/**
 * جدول الدور ← نوع النطاق اللي الدور محتاجه، وهو المصدر الوحيد للحقيقة: قائمة الأدوار اللي بتتدى
 * بالدعوة (IM-Q2، ومعاها دور المالك اللي مش فيها أبداً) ونوع النطاق كلاهما مشتق منه، فتغيير اختيار
 * المالك تعديل بيانات في مكان واحد (BR-5).
 */
export const INVITABLE_SCOPE_TYPE = {
  general_manager: 'COMPANY',
  business_manager: 'BUSINESS',
  branch_manager: 'BRANCH',
  accountant: 'COMPANY',
} as const;

/** كود دور من أدوار الدعوة — مفتاح الجدول فوق. */
export type InvitableRole = keyof typeof INVITABLE_SCOPE_TYPE;

/** أنواع النطاق اللي بتتدى بيها العضوية — قيم الجدول فوق. */
export type InvitationScopeType = (typeof INVITABLE_SCOPE_TYPE)[InvitableRole];

/** الأدوار اللي بتتدى بالدعوة، بترتيب الجدول. */
export const INVITABLE_ROLES = Object.keys(INVITABLE_SCOPE_TYPE) as readonly InvitableRole[];

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
