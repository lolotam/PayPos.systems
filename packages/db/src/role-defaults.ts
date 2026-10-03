import type { Permission } from './access-catalog.ts';

const managers = ['owner', 'general_manager', 'business_manager'] as const;
const settings = managers;

/** الحزم المرجعية النهائية لكل كود؛ إضافة كود بدون قرار صريح تمنع typecheck بدلاً من منحه تلقائياً. */
export const ROLE_DEFAULTS = {
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
  // TODO(spec): مصفوفة البيع لا تحسم إدارة حدود الخصم؛ نوصي بإذن إدارة مستقل داخل النشاط للمدير العام ومدير النشاط.
  'manage:discounts:company': ['owner'],
  // TODO(spec): الاستقبال ليس دوراً مستقلاً والكود على الشركة؛ نوصي بإذن إنشاء داخل النشاط/الفرع للمدير والكاشير.
  'create:customers:company': ['owner'],
  // ADR-0019 يمنع دخول الموظفين الضمني للمالك والمدير؛ الكاشير يحتاج ALLOW شخصي.
  'login:staff:branch': ['staff'],
  'create:companies:platform': [],
} as const satisfies Record<Permission, readonly string[]>;
