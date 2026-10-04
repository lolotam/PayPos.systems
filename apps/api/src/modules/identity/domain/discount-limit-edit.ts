import {
  permissionPossessionFailure,
  permissionHolderIsOwner,
  type PermissionEditContext,
} from './permission-edit.ts';

/**
 * يفحص إذن إدارة الحد المستقل بنطاق العضوية؛ يخفي غير المتاح مثل المجهول ويحمي الذات والمالك.
 *
 * @param context لقطة الشركة والعضويات والصلاحيات بعد القفل
 * @returns رفض مسمى أو null إذا يقدر المدير يعدل الحد
 */
export function discountLimitEditFailure(context: PermissionEditContext) {
  const member = context.membership;
  const target = context.target;
  const code = 'manage:discount-limits:business';
  if (
    member === null ||
    target === null ||
    target.companyId !== context.companyId ||
    !context.catalog.includes(code) ||
    member.startsAt > context.now ||
    (member.endsAt !== null && member.endsAt <= context.now)
  )
    return 'FORBIDDEN' as const;
  // نفس الغلاف قبل فحص هوية صاحب الهدف يمنع استخدام الرسائل لاكتشاف عضويات نشاط آخر.
  if (permissionPossessionFailure(context.grants, code, target, context.descendantTargets) !== null)
    return 'FORBIDDEN' as const;
  if (member.userId === context.editorUserId) return 'PERMISSION_SELF_EDIT' as const;
  // قرار المالك 2026-10-03: المالك النشط مالوش حد خصم، فمحدش يحط له حد أو يغيّره أو يمسحه.
  return permissionHolderIsOwner(context) ? ('PERMISSION_OWNER_PROTECTED' as const) : null;
}
