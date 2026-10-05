import { SYSTEM_ROLES, PERMISSIONS } from '@pospay/db';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  permissionFixture,
  save,
  seedOverride,
  type PermissionFixture,
} from './permissions-screen.fixture.ts';
import { readLeaveAccess } from '../persistence/leave-access.ts';
let f: PermissionFixture;
beforeAll(async () => {
  f = await permissionFixture();
  const role = SYSTEM_ROLES.find((r) => r.code === 'device');
  await f.h
    .owner`UPDATE memberships SET role_id=${role?.id as string},role_owner_key='global' WHERE company_id=${f.company} AND id=${f.managerMember}`;
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
it.each(PERMISSIONS.filter((code) => code.includes(':leave:')))(
  'refuses editing Device grant %s with PERMISSION_ROLE_FORBIDDEN and ignores historical ALLOW',
  async (permission_code) => {
    const decision = await save(f, f.managerMember, {
      permission_code,
      scope_type: 'BRANCH',
      scope_id: f.branch,
    });
    expect(decision.status).toBe(403);
    expect(decision.body['code']).toBe('PERMISSION_ROLE_FORBIDDEN');
    const id = await seedOverride(f, f.managerMember, {
      permission_code,
      scope_type: 'BRANCH',
      scope_id: f.branch,
    });
    const before = await f.h
      .owner`SELECT * FROM permission_overrides WHERE company_id=${f.company} AND id=${id}`;
    const access = await f.db.withTenant(f.company, (tx) =>
      readLeaveAccess(
        tx,
        f.company,
        f.managerId,
        f.business,
        [f.branch],
        new Date(),
        permission_code.endsWith(':own') ? f.managerId : undefined,
      ),
    );
    expect(access).toMatchObject({ read: [], create: [], cancel: [], decide: [], revoke: [] });
    expect(
      Array.from(
        await f.h
          .owner`SELECT * FROM permission_overrides WHERE company_id=${f.company} AND id=${id}`,
      ),
    ).toEqual(Array.from(before));
  },
);
