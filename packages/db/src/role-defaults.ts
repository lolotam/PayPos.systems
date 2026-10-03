import type { Permission } from './access-catalog.ts';

const managers = ['owner', 'general_manager', 'business_manager'] as const;
const settings = managers;

/** الراتب استثناء PR 10: افتراضي المالك مشتق من هويته، ولا يدخل role_permissions أبداً. */
export const OWNER_DERIVED_PERMISSIONS = [
  'read:salaries:business',
  'manage:salaries:business',
] as const satisfies readonly Permission[];

/** التفويض الشخصي للجدول والقوالب يخص الأدوار البشرية؛ دور الجهاز محظور في كل خانة. */
export const SCHEDULE_PERMISSIONS = [
  'read:schedules:branch',
  'manage:schedules:branch',
  'read:schedules:business',
  'manage:schedules:business',
] as const satisfies readonly Permission[];

/** الحزم المرجعية النهائية لكل كود؛ إضافة كود بدون قرار صريح تمنع typecheck بدلاً من منحه تلقائياً. */
export const ROLE_DEFAULTS = {
  'read:salaries:business': [],
  'manage:salaries:business': [],
  'read:schedules:branch': [...managers, 'branch_manager'],
  'manage:schedules:branch': [...managers, 'branch_manager'],
  'read:schedules:business': managers,
  'manage:schedules:business': managers,
  'read:memberships:company': ['owner'],
  'manage:memberships:company': ['owner'],
  'read:memberships:business': ['owner'],
  'manage:memberships:business': ['owner'],
  'read:businesses:company': ['owner', 'general_manager', 'accountant', 'viewer'],
  'create:businesses:company': ['owner', 'general_manager'],
  'create:branches:business': managers,
  'read:branches:branch': [
    ...managers,
    'accountant',
    'branch_manager',
    'shift_supervisor',
    'cashier',
    'waiter',
    'storekeeper',
    'staff',
    'viewer',
  ],
  'manage:devices:branch': [...managers, 'branch_manager'],
  'read:settings:business': settings,
  'manage:settings:business': settings,
  'view:notifications:business': managers,
  'manage:employees:business': managers,
  'manage:files:business': managers,
  'read:files:business': managers,
  // TODO(spec): PR 7d ينفذ قرار 2026-10-04 بإذن مستقل للحد الشخصي للمالك والمدير العام ومدير النشاط، داخل النشاط ومنع تعديل الذات.
  'manage:discounts:company': ['owner'],
  // TODO(spec): PR 7d ينفذ قرار 2026-10-04 بأكواد إنشاء داخل النشاط/الفرع لمدير النشاط ومدير الفرع والكاشير.
  'create:customers:company': ['owner'],
  // ADR-0019 يمنع دخول الموظفين الضمني للمالك والمدير؛ الكاشير يحتاج ALLOW شخصي.
  'login:staff:branch': ['staff'],
  'create:companies:platform': [],
} as const satisfies Record<Permission, readonly string[]>;
