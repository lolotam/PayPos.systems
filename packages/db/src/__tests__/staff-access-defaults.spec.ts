import { expect, it } from 'vitest';
import { PERMISSIONS, SYSTEM_ROLES } from '../access-catalog.ts';
import { ROLE_DEFAULTS } from '../role-defaults.ts';
import { systemRolePolicy } from '../system-role-policy.ts';

const code = 'manage:staff-access:branch' as const;
// قرار D3 (دفعة 103): خانة إعطاء الدخول للمالك ومدير الفرع وحدهما؛ الأدوار المخصصة بلا تفويض
// عليها، والجهاز ممنوع منها أبداً — نفس قاعدة قراءة التقييمات في RT-Q7 لكن بلا تفويض شخصي.
const GRANTERS: readonly string[] = ['owner', 'branch_manager'];

it('D3 the staff-access code is in the permission catalog', () => {
  expect(PERMISSIONS).toContain(code);
});

it('D3 exactly the owner and the branch manager hold it by default', () => {
  expect([...ROLE_DEFAULTS[code]].sort()).toEqual([...GRANTERS].sort());
});

it('D3 no other human role holds it and the device never can', () => {
  for (const role of SYSTEM_ROLES) {
    const held = systemRolePolicy(role.id, 'global')?.permissions.includes(code) ?? false;
    expect(held).toBe(GRANTERS.includes(role.code));
  }
});
