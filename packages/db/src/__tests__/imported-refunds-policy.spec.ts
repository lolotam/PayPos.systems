import { expect, it } from 'vitest';
import { PERMISSIONS, SYSTEM_ROLES } from '../access-catalog.ts';
import { OWNER_GRANTED_PERMISSIONS, ROLE_DEFAULTS } from '../role-defaults.ts';
import { IMPORTED_REFUNDS_PERMISSION as code, POLICY_PERMISSIONS } from '../permission-policy.ts';
import { systemRolePolicy } from '../system-role-policy.ts';

it('activates the code in the catalog once with the owner as the only default', () => {
  expect(PERMISSIONS.filter((entry) => entry === code)).toEqual([code]);
  expect(POLICY_PERMISSIONS.filter((entry) => entry === code)).toEqual([code]);
  expect(ROLE_DEFAULTS[code]).toEqual(['owner']);
  expect(OWNER_GRANTED_PERMISSIONS).toContain(code);
  expect(POLICY_PERMISSIONS).not.toContain('manage:unknown:business');
});
it.each(SYSTEM_ROLES)('$code personal eligibility is human-only', (role) => {
  expect(systemRolePolicy(role.id, 'global')?.permissions.includes(code)).toBe(
    role.code !== 'device',
  );
  expect(systemRolePolicy(role.id, 'company')).toBeNull();
});
