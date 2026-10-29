import { expect, it } from 'vitest';
import { PERMISSIONS, SYSTEM_ROLES } from '../access-catalog.ts';
import { OWNER_GRANTED_PERMISSIONS, ROLE_DEFAULTS } from '../role-defaults.ts';
import { systemRolePolicy } from '../system-role-policy.ts';

// توقع مستقل لكل دور؛ اختبار catalog كامل يمنع ضياع أكواد slices اللاحقة أو تسرب إذن المنصة.
const expectations: Record<string, readonly string[]> = {
  owner: PERMISSIONS.filter(
    (p) => !p.endsWith(':platform') && p !== 'login:staff:branch' && !p.includes(':salaries:'),
  ),
  general_manager: [
    'approve:discounts:branch',
    'edit:service-line-prices:branch',
    'change:service-line-performers:branch',
    'cancel:service-lines:branch',
    'read:service-sessions:branch',
    'record:service-sessions:branch',
    'read:passkeys:branch',
    'unbind:passkeys:branch',
    'create:customers:company',
    'manage:discount-limits:business',
    'read:businesses:company',
    'create:businesses:company',
    'create:branches:business',
    'read:branches:branch',
    'manage:devices:branch',
    'read:settings:business',
    'manage:settings:business',
    'manage:alert-rules:business',
    'manage:staff-app-columns:business',
    'view:notifications:business',
    'manage:employees:business',
    'read:services:business',
    'read:package-types:business',
    'manage:package-types:business',
    'read:service-categories:business',
    'manage:service-categories:business',
    'read:service-categories:branch',
    'manage:service-categories:branch',
    'manage:services:business',
    'clock:attendance:branch',
    'resolve:attendance:branch',
    'read:attendance:branch',
    'correct:attendance:branch',
    'request:attendance-change:branch',
    'read:schedules:branch',
    'manage:schedules:branch',
    'read:schedules:business',
    'manage:schedules:business',
  ],
  business_manager: [
    'approve:discounts:branch',
    'edit:service-line-prices:branch',
    'change:service-line-performers:branch',
    'cancel:service-lines:branch',
    'read:service-sessions:branch',
    'record:service-sessions:branch',
    'read:passkeys:branch',
    'unbind:passkeys:branch',
    'create:customers:business',
    'manage:discount-limits:business',
    'create:branches:business',
    'read:branches:branch',
    'manage:devices:branch',
    'read:settings:business',
    'manage:settings:business',
    'manage:alert-rules:business',
    'manage:staff-app-columns:business',
    'view:notifications:business',
    'manage:employees:business',
    'read:services:business',
    'read:package-types:business',
    'manage:package-types:business',
    'read:service-categories:business',
    'manage:service-categories:business',
    'read:service-categories:branch',
    'manage:service-categories:branch',
    'manage:services:business',
    'clock:attendance:branch',
    'resolve:attendance:branch',
    'read:attendance:branch',
    'correct:attendance:branch',
    'request:attendance-change:branch',
    'read:schedules:branch',
    'manage:schedules:branch',
    'read:schedules:business',
    'manage:schedules:business',
  ],
  accountant: [
    'read:businesses:company',
    'read:branches:branch',
    'read:attendance:branch',
    'manage:commission-plans:business',
  ],
  branch_manager: [
    'approve:discounts:branch',
    'edit:service-line-prices:branch',
    'change:service-line-performers:branch',
    'cancel:service-lines:branch',
    'read:service-sessions:branch',
    'record:service-sessions:branch',
    'read:passkeys:branch',
    'unbind:passkeys:branch',
    'create:customers:branch',
    'read:branches:branch',
    'manage:devices:branch',
    'clock:attendance:branch',
    'resolve:attendance:branch',
    'read:attendance:branch',
    'correct:attendance:branch',
    'request:attendance-change:branch',
    'read:schedules:branch',
    'manage:schedules:branch',
    'read:service-categories:branch',
    'manage:service-categories:branch',
  ],
  shift_supervisor: ['read:branches:branch', 'clock:attendance:branch'],
  cashier: [
    'record:service-sessions:branch',
    'read:branches:branch',
    'create:customers:branch',
    'clock:attendance:branch',
    'login:staff:branch',
  ],
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
    const leaveDefault = code.endsWith(':leave:own')
      ? role.code !== 'device'
      : code.endsWith(':leave:branch')
        ? ['owner', 'general_manager', 'business_manager', 'branch_manager'].includes(role.code)
        : expectations[role.code]?.includes(code);
    expect(actual.includes(role.code)).toBe(leaveDefault);
  });
}

it('CS-Q27 manage:commission-plans:business defaults to owner and accountant, the owner alone grants it, and a device never holds it', () => {
  const code = 'manage:commission-plans:business';
  expect(ROLE_DEFAULTS[code]).toEqual(['owner', 'accountant']);
  expect(OWNER_GRANTED_PERMISSIONS).toContain(code);
  for (const role of SYSTEM_ROLES) {
    expect(systemRolePolicy(role.id, 'global')?.permissions.includes(code)).toBe(
      role.code !== 'device',
    );
  }
});

it('schedule settings default to owner and are eligible for humans only', () => {
  expect(ROLE_DEFAULTS['manage:schedule-settings:business']).toEqual(['owner']);
});

it('attendance decisions default to owner and require an owner grant', () => {
  expect(ROLE_DEFAULTS['decide:attendance-change:company']).toEqual(['owner']);
  expect(OWNER_GRANTED_PERMISSIONS).toContain('decide:attendance-change:company');
});

it.each(SYSTEM_ROLES)('attendance decision eligibility for $code excludes devices', (role) => {
  expect(
    systemRolePolicy(role.id, 'global')?.permissions.includes('decide:attendance-change:company'),
  ).toBe(role.code !== 'device');
});

it.each(SYSTEM_ROLES)(
  'attendance change permission can be granted to $code only if human',
  (role) => {
    expect(
      systemRolePolicy(role.id, 'global')?.permissions.includes('request:attendance-change:branch'),
    ).toBe(role.code !== 'device');
  },
);
it('DH-Q5 employee hours default to owner only', () => {
  expect(ROLE_DEFAULTS['manage:employee-hours:business']).toEqual(['owner']);
});

it('BI-Q1 business identity defaults to the owner and stays owner-granted', () => {
  expect(ROLE_DEFAULTS['manage:business-identity:business']).toEqual(['owner']);
  expect(OWNER_GRANTED_PERMISSIONS).toContain('manage:business-identity:business');
});

it('EN-Q11 employee number defaults to the owner and stays owner-granted', () => {
  expect(ROLE_DEFAULTS['manage:employee-number:company']).toEqual(['owner']);
  expect(OWNER_GRANTED_PERMISSIONS).toContain('manage:employee-number:company');
});

it('cancel:service-lines:branch defaults to the four managers and a device cannot hold it', () => {
  const defaults = ['owner', 'general_manager', 'business_manager', 'branch_manager'];
  const holders: readonly string[] = ROLE_DEFAULTS['cancel:service-lines:branch'];
  expect(holders).toEqual(defaults);
  for (const role of SYSTEM_ROLES) {
    expect(holders.includes(role.code)).toBe(defaults.includes(role.code));
    expect(
      systemRolePolicy(role.id, 'global')?.permissions.includes('cancel:service-lines:branch'),
    ).toBe(role.code !== 'device');
  }
  const staff = SYSTEM_ROLES.find((role) => role.code === 'staff');
  const staffPolicy = systemRolePolicy(staff?.id ?? '', 'global')?.permissions ?? [];
  expect(staffPolicy.includes('cancel:service-lines:branch')).toBe(true);
  expect(
    (ROLE_DEFAULTS['read:service-sessions:branch'] as readonly string[]).includes('staff'),
  ).toBe(false);
  expect(
    staffPolicy.filter(
      (code) => code === 'cancel:service-lines:branch' || code === 'read:service-sessions:branch',
    ),
  ).toEqual(['read:service-sessions:branch', 'cancel:service-lines:branch']);
});

it('change:service-line-performers:branch defaults to the four managers and devices cannot hold it', () => {
  const defaults = ['owner', 'general_manager', 'business_manager', 'branch_manager'];
  const holders: readonly string[] = ROLE_DEFAULTS['change:service-line-performers:branch'];
  expect(holders).toEqual(defaults);
  for (const role of SYSTEM_ROLES) {
    expect(holders.includes(role.code)).toBe(defaults.includes(role.code));
    expect(
      systemRolePolicy(role.id, 'global')?.permissions.includes(
        'change:service-line-performers:branch',
      ),
    ).toBe(role.code !== 'device');
  }
});

it('edit:service-line-prices:branch defaults to the four managers and stays off for everyone else', () => {
  const defaults = ['owner', 'general_manager', 'business_manager', 'branch_manager'];
  const holders: readonly string[] = ROLE_DEFAULTS['edit:service-line-prices:branch'];
  expect(holders).toEqual(defaults);
  for (const role of SYSTEM_ROLES) {
    expect(holders.includes(role.code)).toBe(defaults.includes(role.code));
    expect(
      systemRolePolicy(role.id, 'global')?.permissions.includes('edit:service-line-prices:branch'),
    ).toBe(role.code !== 'device');
  }
});
it.each(SYSTEM_ROLES)('AB-Q2 attendance read eligibility for $code excludes devices', (role) => {
  expect(systemRolePolicy(role.id, 'global')?.permissions.includes('read:attendance:branch')).toBe(
    role.code !== 'device',
  );
});

it('DA-Q1 approve:discounts:branch defaults to the four managers, is delegable to humans and never to the device', () => {
  const defaults = ['owner', 'general_manager', 'business_manager', 'branch_manager'];
  const holders: readonly string[] = ROLE_DEFAULTS['approve:discounts:branch'];
  expect(holders).toEqual(defaults);
  expect(OWNER_GRANTED_PERMISSIONS as readonly string[]).not.toContain('approve:discounts:branch');
  for (const role of SYSTEM_ROLES) {
    expect(
      systemRolePolicy(role.id, 'global')?.permissions.includes('approve:discounts:branch'),
    ).toBe(role.code !== 'device');
  }
});

it('AL-Q1 manage:alert-rules:business defaults to the three managers, is delegable to humans and never the device', () => {
  const defaults = ['owner', 'general_manager', 'business_manager'];
  const holders: readonly string[] = ROLE_DEFAULTS['manage:alert-rules:business'];
  expect(holders).toEqual(defaults);
  expect(OWNER_GRANTED_PERMISSIONS as readonly string[]).not.toContain(
    'manage:alert-rules:business',
  );
  for (const role of SYSTEM_ROLES) {
    expect(
      systemRolePolicy(role.id, 'global')?.permissions.includes('manage:alert-rules:business'),
    ).toBe(role.code !== 'device');
  }
});

it('MY-Q5 manage:staff-app-columns:business defaults to the three managers, is delegable to humans and never the device', () => {
  const defaults = ['owner', 'general_manager', 'business_manager'];
  const holders: readonly string[] = ROLE_DEFAULTS['manage:staff-app-columns:business'];
  expect(holders).toEqual(defaults);
  expect(OWNER_GRANTED_PERMISSIONS as readonly string[]).not.toContain(
    'manage:staff-app-columns:business',
  );
  for (const role of SYSTEM_ROLES) {
    expect(
      systemRolePolicy(role.id, 'global')?.permissions.includes(
        'manage:staff-app-columns:business',
      ),
    ).toBe(role.code !== 'device');
  }
});
