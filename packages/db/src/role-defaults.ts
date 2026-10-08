import type { Permission } from './access-catalog.ts';

const managers = ['owner', 'general_manager', 'business_manager'] as const;
const settings = managers;
const humans = [
  'owner',
  'general_manager',
  'accountant',
  'business_manager',
  'branch_manager',
  'shift_supervisor',
  'cashier',
  'waiter',
  'kitchen',
  'storekeeper',
  'staff',
  'marketing',
  'viewer',
] as const;
/** إجازة الجهاز ممنوعة؛ الإذن الذاتي يحتاج رابط موظف فعلي عند الاستخدام. */
export const LEAVE_PERMISSIONS = [
  'create:leave:own',
  'read:leave:own',
  'cancel:leave:own',
  'create:leave:branch',
  'read:leave:branch',
  'cancel:leave:branch',
  'decide:leave:branch',
  'revoke:leave:branch',
] as const satisfies readonly Permission[];

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
  // قرار المالك 2026-10-04 (UNB-Q1): المديرون الأربعة فقط افتراضياً ضمن نطاقاتهم؛ تفويض الأدوار المخصصة يبقى كما هو.
  'read:passkeys:branch': [...managers, 'branch_manager'],
  'unbind:passkeys:branch': [...managers, 'branch_manager'],
  'create:leave:own': humans,
  'read:leave:own': humans,
  'cancel:leave:own': humans,
  'create:leave:branch': [...managers, 'branch_manager'],
  'read:leave:branch': [...managers, 'branch_manager'],
  'cancel:leave:branch': [...managers, 'branch_manager'],
  // قرار المالك 2026-10-04 (DL-Q4، الخيار الموصى به): الافتراضي للموافقين الأربعة، والتفويض الشخصي متاح لباقي البشر.
  'decide:leave:branch': [...managers, 'branch_manager'],
  'revoke:leave:branch': [...managers, 'branch_manager'],
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
  'read:services:business': managers,
  'read:package-types:business': managers,
  'manage:package-types:business': managers,
  // TODO(spec) SV-Q1: SPEC لا يسمّي صلاحية الكتالوج؛ القرار المؤقت مطابق لـ manage:employees:business.
  'manage:services:business': managers,
  'manage:files:business': managers,
  'read:files:business': managers,
  // قرار المالك 2026-10-04 (DOC-Q2، الخيار الموصى به): أنواع الوثائق للشركة كلها؛ مدير النشاط يحتاج ALLOW شخصياً على مستوى الشركة.
  'manage:document-types:company': ['owner', 'general_manager'],
  'manage:discounts:company': ['owner'],
  'manage:discount-limits:business': managers,
  'create:customers:company': ['owner', 'general_manager'],
  'create:customers:business': ['owner', 'business_manager'],
  'create:customers:branch': ['owner', 'branch_manager', 'cashier'],
  // تصحيح PR 23 بطلب المراجع: كاشير الاستقبال يحتاج الدخول والحضور معاً؛ سلطة المدير وحدها لا تفتح جلسة الموظف.
  'login:staff:branch': ['staff', 'cashier'],
  'clock:attendance:branch': [...managers, 'branch_manager', 'shift_supervisor', 'cashier'],
  // قرار المالك 2026-10-08 (RE-Q3): نفس حائزي decide:leave:branch، والجهاز ممنوع.
  'resolve:attendance:branch': [...managers, 'branch_manager'],
  // قرار المالك 2026-10-08 (CA-Q1): نفس الحائزين، صلاحية مستقلة، والجهاز ممنوع.
  'correct:attendance:branch': [...managers, 'branch_manager'],
  'create:companies:platform': [],
} as const satisfies Record<Permission, readonly string[]>;
