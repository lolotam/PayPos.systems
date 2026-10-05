import { expect, it } from 'vitest';
import { SYSTEM_ROLES } from '../access-catalog.ts';
import { LEAVE_PERMISSIONS, ROLE_DEFAULTS } from '../role-defaults.ts';
import { systemRolePolicy } from '../system-role-policy.ts';
it('Device cannot receive any leave ALLOW, while human own grants and manager branch grants stay explicit', () => {
  for (const role of SYSTEM_ROLES) {
    const policy = systemRolePolicy(role.id, 'global');
    for (const code of LEAVE_PERMISSIONS) {
      const eligible = code.endsWith(':own')
        ? role.code !== 'device'
        : ['owner', 'general_manager', 'business_manager', 'branch_manager'].includes(role.code);
      expect((ROLE_DEFAULTS[code] as readonly string[]).includes(role.code)).toBe(eligible);
      const delegated =
        ['decide:leave:branch', 'revoke:leave:branch', 'read:leave:branch'].includes(code) &&
        role.code !== 'device';
      expect(policy?.permissions.includes(code)).toBe(eligible || delegated);
    }
  }
});
