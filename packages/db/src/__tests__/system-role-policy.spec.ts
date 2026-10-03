import { expect, it } from 'vitest';
import { OWNER_ROLE_ID, SYSTEM_ROLES } from '../access-catalog.ts';
import { systemRolePolicy } from '../system-role-policy.ts';

const role = (code: string) => SYSTEM_ROLES.find((r) => r.code === code)?.id ?? '';
it.each([
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
  expect(systemRolePolicy(role('device'), 'global')).toBeNull();
});
