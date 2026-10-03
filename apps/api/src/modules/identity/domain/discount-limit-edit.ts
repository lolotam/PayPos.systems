import {
  permissionEditFailure,
  permissionHolderIsOwner,
  type PermissionEditContext,
} from './permission-edit.ts';

/**
 * بيطبق سياسة PR 7 على معامل الخصم بنطاق العضوية، مع حماية صاحب العضوية عبر كل عضوياته.
 *
 * @param context لقطة الشركة والعضويات والصلاحيات بعد القفل
 * @returns رفض مسمى أو null إذا يقدر المدير يعدل الحد
 */
export function discountLimitEditFailure(context: PermissionEditContext) {
  const member = context.membership;
  const failure = permissionEditFailure(
    {
      permission_code: 'manage:discounts:company',
      effect: 'ALLOW',
      scope_type: member?.scopeType ?? 'COMPANY',
      scope_id: member?.scopeId ?? context.companyId,
      reason: '',
      expires_at: null,
    },
    context,
    'CHECK',
  );
  if (failure !== null) return failure;
  // قرار المالك 2026-10-03: المالك النشط مالوش حد خصم، فمحدش يحط له حد أو يغيّره أو يمسحه.
  return permissionHolderIsOwner(context) ? 'PERMISSION_OWNER_PROTECTED' : null;
}
