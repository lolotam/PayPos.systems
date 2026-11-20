import { afterAll, beforeAll, expect, it } from 'vitest';
import { SYSTEM_ROLES } from '@pospay/db';
import {
  newMember,
  permissionFixture,
  save,
  type PermissionFixture,
} from './permissions-screen.fixture.ts';

const code = 'read:ratings:branch';
let f: PermissionFixture;

beforeAll(async () => {
  f = await permissionFixture();
  // الكتالوج لسه بدون الكود (61-1c هيزرعه)؛ بنضيفه هنا بس عشان مسار المنح يوصل للحارس.
  await f.h.owner`INSERT INTO permissions(code) VALUES (${code})`;
  const owner = SYSTEM_ROLES.find((role) => role.code === 'owner');
  if (owner === undefined) throw new Error('Missing owner role');
  await f.h.owner`INSERT INTO role_permissions(role_id,role_owner_key,permission_code)
    VALUES (${owner.id},'global',${code})`;
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

/** عضوية حيّة بالدور المطلوب على الفرع؛ المنح الشخصي بيجي بنطاق العضوية نفسها. */
async function memberWithRole(roleCode: string): Promise<string> {
  const member = await newMember(f, roleCode);
  await f.h.owner`UPDATE memberships SET scope_type='BRANCH',scope_id=${f.branch}
    WHERE company_id=${f.company} AND id=${member}`;
  return member;
}

const grant = (member: string, effect: 'ALLOW' | 'DENY') =>
  save(f, member, { permission_code: code, effect, scope_type: 'BRANCH', scope_id: f.branch });

async function state() {
  return {
    overrides: await f.h.owner`SELECT permission_code, effect FROM permission_overrides
      WHERE company_id=${f.company} ORDER BY id`,
    audit: await f.h.owner`SELECT action FROM audit_log WHERE company_id=${f.company} ORDER BY id`,
  };
}

it.each(['cashier', 'synthetic_viewer'])(
  'the role %s is refused with 422 PERMISSION_ROLE_NOT_ELIGIBLE and nothing is written',
  async (roleCode) => {
    const member = await memberWithRole(roleCode);
    const before = await state();
    const refused = await grant(member, 'ALLOW');
    expect(refused.status).toBe(422);
    expect(refused.body['code']).toBe('PERMISSION_ROLE_NOT_ELIGIBLE');
    expect(refused.body['message_ar']).toContain('قراءة التقييمات');
    expect(await state()).toEqual(before);
  },
);

it('the new rule does not refuse a branch manager; the grant waits for the defaults of 61-1c', async () => {
  const member = await memberWithRole('branch_manager');
  const granted = await grant(member, 'ALLOW');
  expect(granted.body['code']).not.toBe('PERMISSION_ROLE_NOT_ELIGIBLE');
});

it('a DENY stays possible for a cashier, so a wrong grant can still be ended', async () => {
  const member = await memberWithRole('cashier');
  const denied = await grant(member, 'DENY');
  expect(denied.status).toBe(201);
  expect(denied.body['effect']).toBe('DENY');
});
