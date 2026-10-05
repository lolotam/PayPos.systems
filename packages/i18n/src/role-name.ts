import { t, type Locale, type MessageKey } from './catalog.js';

const keys: Readonly<Record<string, MessageKey>> = {
  owner: 'roles.owner',
  general_manager: 'roles.general_manager',
  accountant: 'roles.accountant',
  business_manager: 'roles.business_manager',
  branch_manager: 'roles.branch_manager',
  shift_supervisor: 'roles.shift_supervisor',
  cashier: 'roles.cashier',
  waiter: 'roles.waiter',
  kitchen: 'roles.kitchen',
  storekeeper: 'roles.storekeeper',
  staff: 'roles.staff',
  marketing: 'roles.marketing',
  viewer: 'roles.viewer',
};

/** أسماء الأدوار النهائية بقرار المالك 2026-10-03؛ الأدوار المخصصة تحتفظ باسمها المخزن. */
export function roleName(locale: Locale, code: string, fallback: string): string {
  const key = keys[code];
  return key === undefined ? fallback : t(locale, key);
}
