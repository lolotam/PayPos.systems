import { expect, it } from 'vitest';
import { PERMISSIONS, SYSTEM_ROLES } from '../access-catalog.ts';
import { ROLE_DEFAULTS } from '../role-defaults.ts';
import { systemRolePolicy } from '../system-role-policy.ts';

const code = 'read:ratings:branch' as const;
// RT-Q7: خانة قراءة التقييمات للمديرين الأربعة وحدهم؛ الأدوار المخصصة بتفويض المالك والجهاز ممنوع منها.
const READERS: readonly string[] = ['owner', 'general_manager', 'business_manager', 'branch_manager'];

it('RT-Q7 the ratings-read code is in the permission catalog', () => {
  expect(PERMISSIONS).toContain(code);
});

it('RT-Q7 exactly the four manager roles hold it by default', () => {
  expect([...ROLE_DEFAULTS[code]].sort()).toEqual([...READERS].sort());
});

it('RT-Q7 no other human role holds it and the device never can', () => {
  for (const role of SYSTEM_ROLES) {
    const held = systemRolePolicy(role.id, 'global')?.permissions.includes(code) ?? false;
    expect(held).toBe(READERS.includes(role.code));
  }
});
