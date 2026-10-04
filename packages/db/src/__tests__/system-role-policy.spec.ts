import { expect, it } from 'vitest';
import { OWNER_ROLE_ID, SYSTEM_ROLES } from '../access-catalog.ts';
import { systemRolePolicy } from '../system-role-policy.ts';

const role = (code: string) => SYSTEM_ROLES.find((r) => r.code === code)?.id ?? '';
it.each([
  ['branch_manager', 'read:passkeys:branch', true],
  ['branch_manager', 'unbind:passkeys:branch', true],
  ['business_manager', 'unbind:passkeys:branch', true],
  ['general_manager', 'unbind:passkeys:branch', true],
  ['owner', 'unbind:passkeys:branch', true],
  ['staff', 'unbind:passkeys:branch', false],
  ['device', 'read:passkeys:branch', false],
  ['device', 'unbind:passkeys:branch', false],
  ['business_manager', 'manage:memberships:business', true],
  ['business_manager', 'read:memberships:business', true],
  ['business_manager', 'manage:memberships:company', false],
  ['general_manager', 'manage:memberships:company', false],
  ['branch_manager', 'read:settings:business', true],
  ['branch_manager', 'manage:settings:business', true],
  ['viewer', 'manage:devices:branch', false],
  ['viewer', 'read:businesses:company', true],
  ['cashier', 'login:staff:branch', true],
  ['staff', 'login:staff:branch', true],
  ['owner', 'login:staff:branch', false],
  ['kitchen', 'manage:files:business', false],
])('%s personal eligibility for %s is %s', (code, permission, allowed) => {
  expect(
    systemRolePolicy(role(String(code)), 'global')?.permissions.some(
      (entry) => entry === String(permission),
    ),
  ).toBe(allowed);
});
it('recognizes fixed global identities only; company aliases and technical Device keep their own policy', () => {
  expect(systemRolePolicy(OWNER_ROLE_ID, 'global')?.code).toBe('owner');
  expect(systemRolePolicy(OWNER_ROLE_ID, 'synthetic-company')).toBeNull();
  expect(systemRolePolicy('synthetic-custom-owner', 'global')).toBeNull();
  expect(systemRolePolicy(role('device'), 'global')?.code).toBe('device');
});

for (const entry of SYSTEM_ROLES) {
  it.each([
    'read:salaries:business',
    'manage:salaries:business',
    'read:schedules:branch',
    'manage:schedules:branch',
    'read:schedules:business',
    'manage:schedules:business',
  ])(
    entry.code + ' delegation eligibility for %s preserves the integrated policy',
    (permission) => {
      const allowed = systemRolePolicy(entry.id, 'global')?.permissions.some(
        (code) => code === permission,
      );
      expect(allowed).toBe(entry.code !== 'device');
    },
  );
}

it.each([
  'read:memberships:company',
  'manage:memberships:company',
  'read:memberships:business',
  'manage:memberships:business',
  'read:settings:business',
  'manage:settings:business',
  'read:businesses:company',
  'create:businesses:company',
  'read:branches:branch',
  'create:branches:business',
  'manage:devices:branch',
  'view:notifications:business',
  'create:companies:platform',
  'read:files:business',
  'manage:files:business',
  'manage:employees:business',
  'create:customers:company',
  'create:customers:business',
  'create:customers:branch',
  'manage:discounts:company',
  'manage:discount-limits:business',
  'manage:document-types:company',
])('Device cannot acquire spec 009 forbidden %s', (permission) => {
  expect(
    systemRolePolicy(role('device'), 'global')?.permissions.some((code) => code === permission),
  ).toBe(false);
});

for (const entry of SYSTEM_ROLES) {
  it.each([
    [
      'create:customers:company',
      [
        'owner',
        'general_manager',
        'shift_supervisor',
        'accountant',
        'waiter',
        'kitchen',
        'storekeeper',
        'staff',
        'marketing',
        'viewer',
      ],
    ],
    ['create:customers:business', ['owner', 'business_manager']],
    ['create:customers:branch', ['owner', 'branch_manager', 'cashier']],
    ['manage:discount-limits:business', ['owner', 'general_manager', 'business_manager']],
    ['manage:document-types:company', ['owner', 'general_manager', 'business_manager']],
  ] as const)(entry.code + ' follow-up eligibility for %s', (code, roles) => {
    expect(systemRolePolicy(entry.id, 'global')?.permissions.includes(code)).toBe(
      (roles as readonly string[]).includes(entry.code),
    );
  });
}
it('Device retains explicit staff login eligibility', () => {
  expect(systemRolePolicy(role('device'), 'global')?.permissions).toContain('login:staff:branch');
});
