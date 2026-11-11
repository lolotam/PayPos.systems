import { PERMISSIONS, type Permission } from './access-catalog.ts';

/** الحماية تسبق تفعيل الكتالوج؛ هذا التعريف لا يدخل seed ولا يمنح دوراً افتراضياً. */
export const IMPORTED_REFUNDS_PERMISSION = 'manage:imported-refunds:business';

/** أكواد السياسة تشمل الحارس المستقبلي دون توسيع كتالوج التفعيل. */
export type PolicyPermission = Permission | typeof IMPORTED_REFUNDS_PERMISSION;

/** إزالة التكرار تحفظ نفس السياسة عندما يفعّل S الكود لاحقاً. */
export const POLICY_PERMISSIONS: readonly PolicyPermission[] = [
  ...new Set<PolicyPermission>([...PERMISSIONS, IMPORTED_REFUNDS_PERMISSION]),
];
