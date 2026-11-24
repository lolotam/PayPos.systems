// مرآة لافتراضيات أدوار النظام في packages/db (role-defaults سطر 113 و114): صلاحيتا
// create:businesses:company وcreate:branches:business — قاعدة عرض بس، والـ API هو اللي بيقرر.
export const SETUP_BUSINESS_ROLES: readonly string[] = ['owner', 'general_manager'];

export const SETUP_BRANCH_ROLES: readonly string[] = [
  'owner',
  'general_manager',
  'business_manager',
];
