import { expect, it } from 'vitest';
import { PERMISSIONS, SYSTEM_ROLES } from '../access-catalog.ts';
import { ROLE_DEFAULTS } from '../role-defaults.ts';
import { systemRolePolicy } from '../system-role-policy.ts';
import { STAFF_ACCESS_ROLE_DEFAULTS } from '../../../contracts/src/staff/staff-access.ts';

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

// 080-b: الشاشة بتعلّم «افتراضي» على صلاحيات دور الموظفة، والقائمة lives في contracts لأن
// ما تبعتش packages/db للواجهة. الاختبار ده بيمنع أي انحراف بين القائمتين.
const defaultsOf = (roleCode: string): string[] =>
  PERMISSIONS.filter((permission) =>
    (ROLE_DEFAULTS[permission] as readonly string[]).includes(roleCode),
  ).sort();

it('080-b the staff role defaults in contracts are exactly the role defaults in the database', () => {
  expect([...STAFF_ACCESS_ROLE_DEFAULTS.staff].sort()).toEqual(defaultsOf('staff'));
});

it('080-b the reception role defaults in contracts are exactly the cashier defaults in the database', () => {
  expect([...STAFF_ACCESS_ROLE_DEFAULTS.reception].sort()).toEqual(defaultsOf('cashier'));
});

it('080-b every default the screen marks is a permission the role may hold', () => {
  const roleId = (roleCode: string): string =>
    SYSTEM_ROLES.find((role) => role.code === roleCode)?.id ?? '';
  for (const [contractRole, systemRole] of [
    ['staff', 'staff'],
    ['reception', 'cashier'],
  ] as const) {
    const eligible = systemRolePolicy(roleId(systemRole), 'global')?.permissions ?? [];
    for (const permission of STAFF_ACCESS_ROLE_DEFAULTS[contractRole])
      expect(eligible).toContain(permission);
  }
});
