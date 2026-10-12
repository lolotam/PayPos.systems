import { SYSTEM_ROLES } from '@pospay/db';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createAccessReader } from '../persistence/access-reader.ts';
import { AuthorizeRequest } from '../use-cases/authorize-request/authorize-request.ts';
import {
  permissionFixture,
  seedOverride,
  type PermissionFixture,
} from './permissions-screen.fixture.ts';

let f: PermissionFixture;
let otherBranch: string;
beforeAll(async () => {
  f = await permissionFixture();
  otherBranch = f.ids.newId();
  await f.h.owner`INSERT INTO branches(company_id,id,business_id,name_en)
    VALUES(${f.company},${otherBranch},${f.otherBusiness},'Synthetic other branch')`;
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
beforeEach(async () => {
  await f.h
    .owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND membership_id=${f.managerMember}`;
  await f.h.owner`UPDATE memberships SET starts_at=now()-interval '1 day',ends_at=NULL
    WHERE company_id=${f.company} AND id=${f.managerMember}`;
});

async function role(code: string) {
  const selected = SYSTEM_ROLES.find((r) => r.code === code);
  const scope = ['owner', 'general_manager', 'accountant', 'viewer'].includes(code)
    ? 'COMPANY'
    : code === 'business_manager'
      ? 'BUSINESS'
      : 'BRANCH';
  const scopeId = scope === 'COMPANY' ? f.company : scope === 'BUSINESS' ? f.business : f.branch;
  await f.h.owner`UPDATE memberships SET role_id=${selected?.id as string},role_owner_key='global',
    scope_type=${scope},scope_id=${scopeId} WHERE company_id=${f.company} AND id=${f.managerMember}`;
}

async function parity(permission: string, active = true) {
  const reader = createAccessReader(f.db);
  const accessRead = vi.spyOn(reader, 'accessIn');
  const targetsRead = vi.spyOn(reader, 'businessesOfBranches');
  const membershipRead = vi.spyOn(reader, 'companiesOf');
  const authorizer = new AuthorizeRequest(reader);
  const branches = [f.branch, f.siblingBranch, otherBranch, f.foreignBranch, f.ids.newId()];
  const input = { userId: f.managerId, requestedCompany: f.company, permission };
  const batch = await authorizer.executeBranches({
    ...input,
    branchParams: [...branches, f.branch.toUpperCase(), 'invalid'],
  });
  expect(accessRead).toHaveBeenCalledTimes(active ? 1 : 0);
  expect(targetsRead).toHaveBeenCalledTimes(active ? 1 : 0);
  expect(membershipRead).toHaveBeenCalledTimes(1);
  const singles = await Promise.all(
    branches.map(
      async (branchParam) =>
        [branchParam, (await authorizer.execute({ ...input, branchParam })) !== null] as const,
    ),
  );
  expect(batch).toEqual(new Map(singles));
  expect(await authorizer.execute({ ...input, branchParam: 'invalid' })).toBeNull();
  return { batch, branches };
}

it.each(
  SYSTEM_ROLES.flatMap(({ code }) =>
    [
      'resolve:attendance:branch',
      'request:attendance-change:branch',
      'read:attendance:branch',
      'login:staff:branch',
    ].map((permission) => ({ code, permission })),
  ),
)(
  '$code batch matches single reads for $permission, including ALLOW/DENY and owner/device rules',
  async ({ code, permission }) => {
    await role(code);
    await parity(permission);
    await seedOverride(f, f.managerMember, {
      permission_code: permission,
      effect: 'ALLOW',
      scope_type: 'BUSINESS',
      scope_id: f.business,
    });
    await seedOverride(f, f.managerMember, {
      permission_code: permission,
      effect: 'DENY',
      scope_type: 'BRANCH',
      scope_id: f.siblingBranch,
    });
    await seedOverride(f, f.managerMember, {
      permission_code: permission,
      effect: 'DENY',
      scope_type: 'BRANCH',
      scope_id: f.branch,
      expires_at: '2020-01-01T00:00:00Z',
    });
    await parity(permission);
  },
);

it('company ALLOW and branch DENY keep other branches available with one access read', async () => {
  await role('general_manager');
  await seedOverride(f, f.managerMember, {
    permission_code: 'resolve:attendance:branch',
    effect: 'ALLOW',
  });
  await seedOverride(f, f.managerMember, {
    permission_code: 'resolve:attendance:branch',
    effect: 'DENY',
    scope_type: 'BRANCH',
    scope_id: f.siblingBranch,
  });
  const { batch } = await parity('resolve:attendance:branch');
  expect(batch.get(f.branch)).toBe(true);
  expect(batch.get(f.siblingBranch)).toBe(false);
  expect(batch.get(otherBranch)).toBe(true);
});

it.each(['starts_at', 'ends_at'] as const)(
  'inactive membership window (%s) refuses every branch before tenant access',
  async (column) => {
    await role('general_manager');
    if (column === 'starts_at')
      await f.h
        .owner`UPDATE memberships SET starts_at=now()+interval '1 day' WHERE company_id=${f.company} AND id=${f.managerMember}`;
    else
      await f.h
        .owner`UPDATE memberships SET ends_at=now()-interval '1 hour' WHERE company_id=${f.company} AND id=${f.managerMember}`;
    const reader = createAccessReader(f.db);
    const accessRead = vi.spyOn(reader, 'accessIn');
    const authorizer = new AuthorizeRequest(reader);
    const batch = await authorizer.executeBranches({
      userId: f.managerId,
      requestedCompany: f.company,
      permission: 'resolve:attendance:branch',
      branchParams: [f.branch, f.siblingBranch],
    });
    expect([...batch.values()]).toEqual([false, false]);
    expect(accessRead).not.toHaveBeenCalled();
    await parity('resolve:attendance:branch', false);
  },
);

it('foreign company is refused without any tenant access', async () => {
  await role('general_manager');
  const tenant = vi.spyOn(f.db, 'withTenant');
  try {
    const reader = createAccessReader(f.db);
    const authorizer = new AuthorizeRequest(reader);
    expect(
      await authorizer.executeBranches({
        userId: f.managerId,
        requestedCompany: f.otherCompany,
        permission: 'resolve:attendance:branch',
        branchParams: [f.foreignBranch],
      }),
    ).toEqual(new Map([[f.foreignBranch, false]]));
    expect(tenant).not.toHaveBeenCalled();
  } finally {
    tenant.mockRestore();
  }
});

it('an empty batch reads no membership, targets or grants', async () => {
  const reader = createAccessReader(f.db);
  const memberships = vi.spyOn(reader, 'companiesOf');
  expect(
    await new AuthorizeRequest(reader).executeBranches({
      userId: f.managerId,
      requestedCompany: f.company,
      permission: 'resolve:attendance:branch',
      branchParams: [],
    }),
  ).toEqual(new Map());
  expect(memberships).not.toHaveBeenCalled();
});
