import { PERMISSIONS, type Permission } from './access-catalog.ts';

/** كود مفتاح مرتجع الباقات المستوردة: اسم مشترك بين سياسة الأدوار وقاعدة "المالك وحده يمنحه" وصف الـ seed. */
export const IMPORTED_REFUNDS_PERMISSION = 'manage:imported-refunds:business';

/** أكواد السياسة: الكتالوج كله، والاسم المشترك فوق ضمنه أصلاً. */
export type PolicyPermission = Permission;

/** إزالة التكرار تحفظ نفس السياسة بعد تفعيل الكود في الكتالوج. */
export const POLICY_PERMISSIONS: readonly PolicyPermission[] = [
  ...new Set<PolicyPermission>([...PERMISSIONS, IMPORTED_REFUNDS_PERMISSION]),
];
