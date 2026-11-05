import { SYSTEM_ROLES } from '@pospay/db';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { readAccessTransaction } from '../persistence/access-reader.ts';
import { evaluateAccess } from '../domain/access.ts';
import {
  permissionFixture,
  save,
  seedOverride,
  type PermissionFixture,
} from './permissions-screen.fixture.ts';

const codes = [
  'read:service-sessions:own',
  'read:commissions:own',
  'read:attendance:own',
  'read:ratings:own',
];
let f: PermissionFixture;
let customRole: string;
beforeAll(async () => {
  f = await permissionFixture();
  const [member] = await f.h
    .owner`SELECT role_id FROM memberships WHERE company_id=${f.company} AND id=${f.managerMember}`;
  customRole = member?.['role_id'] as string;
});
beforeEach(async () => {
  await f.h
    .owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND membership_id IN (${f.managerMember},${f.ownMember})`;
  await f.h
    .owner`UPDATE memberships SET role_id=${customRole},role_owner_key=${f.company},starts_at=${new Date(Date.now() - 60_000).toISOString()},ends_at=NULL WHERE company_id=${f.company} AND id=${f.managerMember}`;
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
const target = () => ({
  companyId: f.company,
  businessId: f.business,
  branchId: f.branch,
  actorUserId: f.managerId,
  subjectUserId: f.managerId,
});
const read = (userId: string, now = new Date()) =>
  f.db.withTenant(f.company, (tx) => readAccessTransaction(tx, f.company, userId, now));

it.each(codes)(
  'MY-11 %s personal DENY affects only its holder and never bypasses own identity',
  async (code) => {
    await seedOverride(f, f.managerMember, { permission_code: code });
    expect(evaluateAccess((await read(f.managerId)).grants, code, target())).toBe(true);
    await seedOverride(f, f.managerMember, {
      permission_code: code,
      effect: 'DENY',
      scope_type: 'BRANCH',
      scope_id: f.branch,
    });
    const grants = (await read(f.managerId)).grants;
    expect(evaluateAccess(grants, code, target())).toBe(false);
    expect(evaluateAccess(grants, code, { ...target(), branchId: f.siblingBranch })).toBe(true);
    const ownerTarget = { ...target(), actorUserId: f.userId, subjectUserId: f.userId };
    await seedOverride(f, f.ownMember, { permission_code: code, effect: 'DENY' });
    const owner = (await read(f.userId)).grants;
    expect(evaluateAccess(owner, code, ownerTarget)).toBe(true);
    expect(evaluateAccess(owner, code, { ...ownerTarget, subjectUserId: f.managerId })).toBe(false);
  },
);

it('MY-10 an ended or future membership supplies no own authority on the next transaction', async () => {
  const now = new Date();
  await f.h
    .owner`UPDATE memberships SET ends_at=${now.toISOString()} WHERE company_id=${f.company} AND id=${f.managerMember}`;
  expect((await read(f.managerId, now)).grants).toEqual([]);
  await f.h
    .owner`UPDATE memberships SET ends_at=NULL,starts_at=${new Date(now.getTime() + 60_000).toISOString()} WHERE company_id=${f.company} AND id=${f.managerMember}`;
  expect((await read(f.managerId, now)).grants).toEqual([]);
  await f.h
    .owner`UPDATE memberships SET starts_at=${new Date(now.getTime() - 60_000).toISOString()} WHERE company_id=${f.company} AND id=${f.managerMember}`;
});

it('MY-11 a custom role named owner has no DENY immunity', async () => {
  await f.h
    .owner`UPDATE roles SET code='owner' WHERE company_id=${f.company} AND id=(SELECT role_id FROM memberships WHERE company_id=${f.company} AND id=${f.managerMember})`;
  for (const code of codes) {
    await seedOverride(f, f.managerMember, { permission_code: code });
    await seedOverride(f, f.managerMember, { permission_code: code, effect: 'DENY' });
  }
  const access = await read(f.managerId);
  for (const code of codes) expect(evaluateAccess(access.grants, code, target())).toBe(false);
});

it('MY-12 foreign company has no grants and expired ALLOW cannot authorize a sibling branch', async () => {
  const foreign = await f.db.withTenant(f.otherCompany, (tx) =>
    readAccessTransaction(tx, f.otherCompany, f.managerId),
  );
  expect(foreign.grants).toEqual([]);
  const now = new Date();
  for (const code of codes)
    await seedOverride(f, f.managerMember, {
      permission_code: code,
      expires_at: now.toISOString(),
    });
  const access = await read(f.managerId, now);
  for (const code of codes)
    expect(evaluateAccess(access.grants, code, { ...target(), branchId: f.siblingBranch })).toBe(
      false,
    );
});

it.each(codes)(
  'MY-09 %s device grants are forbidden and historical ALLOW stays inert',
  async (code) => {
    const deviceId = SYSTEM_ROLES.find((role) => role.code === 'device')?.id ?? '';
    await f.h
      .owner`UPDATE memberships SET role_id=${deviceId},role_owner_key='global' WHERE company_id=${f.company} AND id=${f.managerMember}`;
    const response = await save(f, f.managerMember, { permission_code: code });
    expect(response.status).toBe(403);
    expect(response.body['code']).toBe('PERMISSION_ROLE_FORBIDDEN');
    const overrideId = await seedOverride(f, f.managerMember, { permission_code: code });
    await f.h
      .owner`INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code) VALUES (${deviceId},'global',NULL,${code}) ON CONFLICT DO NOTHING`;
    const before = Array.from(
      await f.h
        .owner`SELECT * FROM permission_overrides WHERE company_id=${f.company} AND id=${overrideId}`,
    );
    const access = await read(f.managerId);
    expect(
      access.grants.filter((grant) => grant.permission === code && grant.effect === 'ALLOW'),
    ).toEqual([]);
    expect(evaluateAccess(access.grants, code, target())).toBe(false);
    expect(
      Array.from(
        await f.h
          .owner`SELECT * FROM permission_overrides WHERE company_id=${f.company} AND id=${overrideId}`,
      ),
    ).toEqual(before);
  },
);
