import { evaluateAccess, type AccessGrant, type AccessTarget } from './access.ts';
import { permissionPossessionFailure } from './permission-edit.ts';

/**
 * بيحمي افتراضي النشاط بنفس سياسة امتلاك الإذن في PR 7، بما فيها DENY على فرع تابع.
 * إعداد النشاط يخص كل الفروع، لذلك مدير فرع واحد لا يغير سلطة بقية النشاط.
 *
 * @param grants الصلاحيات السارية بعد القفل
 * @param target النشاط المؤكد أو null لو غير متاح
 * @param descendants فروع النشاط
 * @returns سبب الرفض أو null لو كل النطاق مغطى
 */
export function businessDiscountEditFailure(
  grants: readonly AccessGrant[],
  target: AccessTarget | null,
  descendants: readonly AccessTarget[],
): 'FORBIDDEN' | 'PERMISSION_NOT_HELD' | 'PERMISSION_SCOPE_OUTSIDE_REACH' | null {
  if (target === null || !evaluateAccess(grants, 'manage:settings:business', target))
    return 'FORBIDDEN';
  return permissionPossessionFailure(grants, 'manage:discounts:company', target, descendants);
}
