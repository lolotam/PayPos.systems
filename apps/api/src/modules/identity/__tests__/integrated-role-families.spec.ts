import { afterAll, beforeAll, expect, it } from 'vitest';
import { membershipPermissions } from '@pospay/contracts';
import { OWNER_DERIVED_PERMISSIONS, SYSTEM_ROLES } from '@pospay/db';
import { AuthorizeRequest } from '../use-cases/authorize-request/authorize-request.ts';
import { createAccessReader } from '../persistence/access-reader.ts';
import { readEmployeeSalaryAccess } from '../persistence/employee-salary-access.ts';
import {
  permissionFixture,
  save,
  seedOverride,
  type PermissionFixture,
} from './permissions-screen.fixture.ts';

let f: PermissionFixture;
const salaries = OWNER_DERIVED_PERMISSIONS;
const schedules = [
  'read:schedules:branch',
  'manage:schedules:branch',
  'read:schedules:business',
  'manage:schedules:business',
] as const;
beforeAll(async () => {
  f = await permissionFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
async function actorRole(code: string) {
  await f.h
    .owner`UPDATE permission_overrides SET expires_at=now() WHERE company_id=${f.company} AND membership_id=${f.managerMember}`;
  const role = SYSTEM_ROLES.find((r) => r.code === code);
  await f.h
    .owner`UPDATE memberships SET role_id=${role?.id as string},role_owner_key='global',scope_type='BUSINESS',scope_id=${f.business}
    WHERE company_id=${f.company} AND id=${f.managerMember}`;
}
function salaryAccess(business = f.business, branch = f.branch) {
  return f.db.withTenant(f.company, (tx) =>
    readEmployeeSalaryAccess(tx, f.company, f.managerId, business, [branch]),
  );
}
function authorize(permission: string, elsewhere = false) {
  return new AuthorizeRequest(createAccessReader(f.db)).execute({
    userId: f.managerId,
    requestedCompany: f.company,
    permission,
    ...(permission.endsWith(':branch')
      ? { branchParam: elsewhere ? f.foreignBranch : f.branch }
      : { businessParam: elsewhere ? f.otherBusiness : f.business }),
  });
}
async function scheduleDelegation(code: string, defaults: readonly string[]) {
  for (const permission_code of schedules) {
    const defaultAllowed =
      ['general_manager', 'business_manager'].includes(code) ||
      (code === 'branch_manager' && permission_code.endsWith(':branch'));
    expect((await authorize(permission_code)) !== null).toBe(defaultAllowed);
    expect(defaults.includes(permission_code)).toBe(defaultAllowed);
    const branch = permission_code.endsWith(':branch');
    expect(
      (
        await save(f, f.managerMember, {
          permission_code,
          scope_type: branch ? 'BRANCH' : 'BUSINESS',
          scope_id: branch ? f.branch : f.business,
        })
      ).status,
    ).toBe(201);
    expect(await authorize(permission_code)).not.toBeNull();
    expect(await authorize(permission_code, true)).toBeNull();
  }
}

it.each(SYSTEM_ROLES.filter((r) => r.code !== 'owner'))(
  '$code salary delegation stays optional; schedule defaults and personal grants preserve PR 16',
  async ({ code }) => {
    await actorRole(code);
    expect(await salaryAccess()).toMatchObject({ read: false, manage: false });
    const manage = await save(f, f.managerMember, {
      permission_code: salaries[1],
      scope_type: 'BUSINESS',
      scope_id: f.business,
    });
    expect(manage.status).toBe(code === 'device' ? 403 : 201);
    expect(await salaryAccess()).toMatchObject({ read: false, manage: false });
    const reading = await save(f, f.managerMember, {
      permission_code: salaries[0],
      scope_type: 'BUSINESS',
      scope_id: f.business,
    });
    expect(reading.status).toBe(code === 'device' ? 403 : 201);
    if (code === 'device') {
      expect(reading.body['code']).toBe('PERMISSION_ROLE_FORBIDDEN');
      for (const permission_code of salaries)
        await seedOverride(f, f.managerMember, {
          permission_code,
          scope_type: 'BUSINESS',
          scope_id: f.business,
        });
    }
    expect(await salaryAccess()).toMatchObject({
      read: code !== 'device',
      manage: code !== 'device',
    });
    expect(await salaryAccess(f.otherBusiness, f.foreignBranch)).toMatchObject({
      read: false,
      manage: false,
    });
    const detail = await f.h.send('GET', '/v1/permissions/memberships/' + f.managerMember, {
      cookie: f.cookie,
      company: f.company,
    });
    expect(detail.status).toBe(200);
    const defaults = membershipPermissions.parse(detail.body).role_defaults;
    for (const permission of salaries)
      expect(detail.body['role_defaults']).not.toContain(permission);
    await scheduleDelegation(code, defaults);
  },
);
it('canonical Owner has derived salary defaults in effective access and on the permissions screen', async () => {
  const detail = await f.h.send('GET', '/v1/permissions/memberships/' + f.ownMember, {
    cookie: f.cookie,
    company: f.company,
  });
  for (const permission of [...salaries, ...schedules])
    expect(detail.body['role_defaults']).toContain(permission);
  const historical = await seedOverride(f, f.ownMember, {
    permission_code: salaries[0],
    effect: 'DENY',
    scope_type: 'BUSINESS',
    scope_id: f.business,
  });
  const result = await f.db.withTenant(f.company, (tx) =>
    readEmployeeSalaryAccess(tx, f.company, f.userId, f.business, [f.branch]),
  );
  expect(result).toMatchObject({ read: true, manage: true });
  expect(
    await f.h
      .owner`SELECT effect FROM permission_overrides WHERE company_id=${f.company} AND id=${historical}`,
  ).toMatchObject([{ effect: 'DENY' }]);
  expect(
    await f.h
      .owner`SELECT 1 FROM role_permissions WHERE permission_code IN ('read:salaries:business','manage:salaries:business')`,
  ).toHaveLength(0);
});
it('a company role coded owner neither derives salary access nor ignores a personal DENY', async () => {
  const custom = f.ids.newId();
  await f.h
    .owner`INSERT INTO roles(id,company_id,code,name_en) VALUES (${custom},${f.company},'owner','Synthetic owner alias')`;
  await actorRole('viewer');
  await f.h
    .owner`UPDATE memberships SET role_id=${custom},role_owner_key=${f.company} WHERE company_id=${f.company} AND id=${f.managerMember}`;
  for (const permission_code of salaries)
    await f.h
      .owner`INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code) VALUES (${custom},${f.company},${f.company},${permission_code})`;
  expect(await salaryAccess()).toMatchObject({ read: false, manage: false });
  const detail = await f.h.send('GET', '/v1/permissions/memberships/' + f.managerMember, {
    cookie: f.cookie,
    company: f.company,
  });
  for (const permission of salaries) expect(detail.body['role_defaults']).not.toContain(permission);
  for (const permission_code of salaries)
    expect(
      (
        await save(f, f.managerMember, {
          permission_code,
          scope_type: 'BUSINESS',
          scope_id: f.business,
        })
      ).status,
    ).toBe(201);
  expect(await salaryAccess()).toMatchObject({ read: true, manage: true });
  await seedOverride(f, f.managerMember, {
    permission_code: salaries[0],
    effect: 'DENY',
    scope_type: 'BUSINESS',
    scope_id: f.business,
  });
  expect(await salaryAccess()).toMatchObject({ read: false, manage: false });
});
