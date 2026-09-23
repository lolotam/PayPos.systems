// الـ catalog بتاع الصلاحيات والـ roles اللي بيتزرع من الكود (ADR-0003 §2.3). كل slice بتضيف صلاحياتها هنا
// في نفس الـ PR اللي بيعمل الـ route بتاعها، والـ Owner بياخدها أوتوماتيك (قرار Waleed 2026-09-23).

/**
 * كل صلاحية معروفة للنظام بالشكل 'action:resource:scope'. الـ scope بيحدد الـ target اللي الـ guard بيقيّم عنده.
 */
export const PERMISSIONS = [
  'read:memberships:company',
  'manage:memberships:company',
  'read:businesses:company',
  'create:businesses:company',
  'create:branches:business',
  'read:branches:branch',
  // صلاحية منصة: بتتدي بـ pnpm platform:grant بس، وعمرها ما بتبقى في role شركة (ADR-0003 §3).
  'create:companies:platform',
] as const;

export type Permission = (typeof PERMISSIONS)[number];
/** صلاحية على مستوى المنصة — بتتدي بـ platform_grants بس. */
export type PlatformPermission = Extract<Permission, `${string}:platform`>;
/** صلاحية جوه شركة — بتتدي بالـ roles والـ overrides. */
export type TenantPermission = Exclude<Permission, PlatformPermission>;

/**
 * role نظام واحد: id ثابت عشان الـ seed يتعاد من غير ما يكرر، والـ code اللي بيتقارن بيه في الكود.
 */
export interface SystemRole {
  readonly id: string;
  readonly code: string;
  readonly nameEn: string;
}

// TODO(spec): الـ codes مؤقتة لحد قرار D-07 (PRD §13) — تغيير الاسم بعدين data migration. الأسماء العربي
// مستنية نفس القرار. كل role غير Owner ملوش صلاحيات لحد ما D-07 يحدد الـ bundles.
export const SYSTEM_ROLES: readonly SystemRole[] = [
  { id: '01920000-0000-7000-8000-000000000101', code: 'owner', nameEn: 'Owner' },
  {
    id: '01920000-0000-7000-8000-000000000102',
    code: 'general_manager',
    nameEn: 'General Manager',
  },
  { id: '01920000-0000-7000-8000-000000000103', code: 'accountant', nameEn: 'Accountant' },
  {
    id: '01920000-0000-7000-8000-000000000104',
    code: 'business_manager',
    nameEn: 'Business Manager',
  },
  { id: '01920000-0000-7000-8000-000000000105', code: 'branch_manager', nameEn: 'Branch Manager' },
  {
    id: '01920000-0000-7000-8000-000000000106',
    code: 'shift_supervisor',
    nameEn: 'Shift Supervisor',
  },
  { id: '01920000-0000-7000-8000-000000000107', code: 'cashier', nameEn: 'Cashier' },
  { id: '01920000-0000-7000-8000-000000000108', code: 'waiter', nameEn: 'Waiter' },
  { id: '01920000-0000-7000-8000-000000000109', code: 'kitchen', nameEn: 'Kitchen' },
  { id: '01920000-0000-7000-8000-00000000010a', code: 'storekeeper', nameEn: 'Storekeeper' },
  { id: '01920000-0000-7000-8000-00000000010b', code: 'staff', nameEn: 'Staff' },
  { id: '01920000-0000-7000-8000-00000000010c', code: 'marketing', nameEn: 'Marketing' },
  { id: '01920000-0000-7000-8000-00000000010d', code: 'viewer', nameEn: 'Viewer' },
];

export const OWNER_ROLE_ID = '01920000-0000-7000-8000-000000000101';
