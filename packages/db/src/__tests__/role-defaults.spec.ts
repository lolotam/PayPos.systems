import { expect, it } from 'vitest';
import { PERMISSIONS, SYSTEM_ROLES } from '../access-catalog.ts';
import { ROLE_DEFAULTS } from '../role-defaults.ts';

// توقع مستقل لكل دور؛ اختبار catalog كامل يمنع ضياع أكواد slices اللاحقة أو تسرب إذن المنصة.
const expectations: Record<string, readonly string[]> = {
  owner: PERMISSIONS.filter(
    (p) => !p.endsWith(':platform') && p !== 'login:staff:branch' && !p.includes(':salaries:'),
  ),
  general_manager: [
    'read:businesses:company',
    'create:businesses:company',
    'create:branches:business',
    'read:branches:branch',
    'manage:devices:branch',
    'read:settings:business',
    'manage:settings:business',
    'view:notifications:business',
    'manage:employees:business',
    'manage:files:business',
    'read:files:business',
    'read:schedules:branch',
    'manage:schedules:branch',
    'read:schedules:business',
    'manage:schedules:business',
  ],
  business_manager: [
    'create:branches:business',
    'read:branches:branch',
    'manage:devices:branch',
    'read:settings:business',
    'manage:settings:business',
    'view:notifications:business',
    'manage:employees:business',
    'manage:files:business',
    'read:files:business',
    'read:schedules:branch',
    'manage:schedules:branch',
    'read:schedules:business',
    'manage:schedules:business',
  ],
  accountant: ['read:businesses:company', 'read:branches:branch'],
  branch_manager: [
    'read:branches:branch',
    'manage:devices:branch',
    'read:schedules:branch',
    'manage:schedules:branch',
  ],
  shift_supervisor: ['read:branches:branch'],
  cashier: ['read:branches:branch'],
  waiter: ['read:branches:branch'],
  kitchen: [],
  storekeeper: ['read:branches:branch'],
  staff: ['read:branches:branch', 'login:staff:branch'],
  marketing: [],
  viewer: ['read:businesses:company', 'read:branches:branch'],
  device: [],
};

it('covers exactly the current catalog and every system role', () => {
  expect(Object.keys(ROLE_DEFAULTS).sort()).toEqual([...PERMISSIONS].sort());
  expect(Object.keys(expectations).sort()).toEqual(SYSTEM_ROLES.map((r) => r.code).sort());
});
for (const role of SYSTEM_ROLES) {
  it.each(PERMISSIONS)(`${role.code} default for %s follows the owner matrix`, (code) => {
    const actual: readonly string[] = ROLE_DEFAULTS[code];
    expect(actual.includes(role.code)).toBe(expectations[role.code]?.includes(code));
  });
}
