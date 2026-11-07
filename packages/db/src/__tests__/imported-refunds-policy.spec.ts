import { expect, it } from 'vitest';
import { PERMISSIONS, SYSTEM_ROLES } from '../access-catalog.ts';
import { OWNER_GRANTED_PERMISSIONS, ROLE_DEFAULTS } from '../role-defaults.ts';
import { IMPORTED_REFUNDS_PERMISSION as code, POLICY_PERMISSIONS } from '../permission-policy.ts';
import { systemRolePolicy } from '../system-role-policy.ts';

it('knows the future policy exactly once without activating seed catalog/defaults', () => {
  expect(POLICY_PERMISSIONS.filter((entry) => entry === code)).toEqual([code]);
  expect(PERMISSIONS).not.toContain(code);
  expect(Object.keys(ROLE_DEFAULTS)).not.toContain(code);
  expect(OWNER_GRANTED_PERMISSIONS).toContain(code);
  expect(POLICY_PERMISSIONS).not.toContain('manage:unknown:business');
});
it.each(SYSTEM_ROLES)('$code future personal eligibility is human-only', (role) => {
  expect(systemRolePolicy(role.id, 'global')?.permissions.includes(code)).toBe(
    role.code !== 'device',
  );
  expect(systemRolePolicy(role.id, 'company')).toBeNull();
});
