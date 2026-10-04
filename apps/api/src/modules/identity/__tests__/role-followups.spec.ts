import { readFileSync } from 'node:fs';
import { PERMISSIONS, SYSTEM_ROLES, systemRolePolicy } from '@pospay/db';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { AuthorizeRequest } from '../use-cases/authorize-request/authorize-request.ts';
import { getMembershipPermissions } from '../queries/membership-permissions.query.ts';
import { createAccessReader } from '../persistence/access-reader.ts';
import {
  newMember,
  newHeldMember,
  permissionFixture,
  revoke,
  save,
  seedOverride,
  type PermissionFixture,
} from './permissions-screen.fixture.ts';

let f: PermissionFixture;
let otherBranch: string;
beforeAll(async () => {
  f = await permissionFixture();
  otherBranch = f.ids.newId();
  await f.h.owner`INSERT INTO branches(company_id,id,business_id,name_en)
    VALUES (${f.company},${otherBranch},${f.otherBusiness},'Synthetic other branch')`;
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
async function actorRole(code: string) {
  const role = SYSTEM_ROLES.find((r) => r.code === code)?.id ?? '';
  const scope =
    code === 'business_manager'
      ? 'BUSINESS'
      : ['general_manager', 'owner'].includes(code)
        ? 'COMPANY'
        : 'BRANCH';
  const scopeId = scope === 'COMPANY' ? f.company : scope === 'BUSINESS' ? f.business : f.branch;
  await f.h.owner`UPDATE memberships SET role_id=${role},role_owner_key='global',
    scope_type=${scope},scope_id=${scopeId} WHERE company_id=${f.company} AND id=${f.managerMember}`;
}
const post = (path: string, body: object, cookie = f.managerCookie, company = f.company) =>
  f.h.send('POST', path, { cookie, company, body });
const payload = {
  phone: { calling_code: '1', national_number: '2025550130' },
  name: 'Synthetic customer',
  locale: 'en',
};
const branchPath = (id: string) => `/v1/branches/${id}/customers/find-or-create`;
const businessPath = (id: string) => `/v1/businesses/${id}/customers/find-or-create`;
const limitPath = (id: string) => `/v1/permissions/memberships/${id}/discount-limit`;
const limit = { limit_bps: 1234, reason: 'Synthetic administration' };
const envelope = (r: { status: number; body: unknown }) => ({ status: r.status, body: r.body });
async function scopedMember(type: string, scope: string) {
  const id = await newMember(f);
  await f.h.owner`UPDATE memberships SET scope_type=${type},scope_id=${scope}
    WHERE company_id=${f.company} AND id=${id}`;
  return id;
}

it.each(['cashier', 'branch_manager'])(
  '%s creates only from own branch and cannot acquire company creation',
  async (role) => {
    await actorRole(role);
    const own = await post(branchPath(f.branch), payload);
    expect(own.status).toBe(200);
    expect(own.body['phone']).toBe('***130');
    const unknown = envelope(await post(branchPath(f.ids.newId()), payload));
    expect(unknown.status).toBe(403);
    for (const branch of [f.siblingBranch, otherBranch, f.foreignBranch])
      expect(envelope(await post(branchPath(branch), payload))).toEqual(unknown);
    expect((await post(businessPath(f.business), payload)).status).toBe(403);
    expect((await post('/v1/customers/find-or-create', payload)).status).toBe(403);
    expect(
      (await post(branchPath(f.foreignBranch), payload, f.managerCookie, f.otherCompany)).status,
    ).toBe(403);
    const decision = await save(f, f.managerMember, {
      permission_code: 'create:customers:branch',
      scope_type: 'COMPANY',
      scope_id: f.company,
    });
    expect(decision.body['code']).toBe('PERMISSION_SCOPE_OUTSIDE_REACH');
    const historical = await seedOverride(f, f.managerMember, {
      permission_code: 'create:customers:branch',
    });
    expect(envelope(await post(branchPath(f.siblingBranch), payload))).toEqual(unknown);
    await f.h
      .owner`UPDATE permission_overrides SET expires_at=now() WHERE id=${historical} AND company_id=${f.company}`;
  },
);

it('BM customer creation is business-context only and customer deduplication remains company-wide', async () => {
  await actorRole('business_manager');
  const created = await post(businessPath(f.business), payload);
  expect(created.status).toBe(200);
  const unknown = envelope(await post(businessPath(f.ids.newId()), payload));
  expect(envelope(await post(businessPath(f.otherBusiness), payload))).toEqual(unknown);
  expect((await post('/v1/customers/find-or-create', payload)).status).toBe(403);
  const owner = await post('/v1/customers/find-or-create', payload, f.cookie);
  expect(owner.body['id']).toBe(created.body['id']);
  expect(await f.h.owner`SELECT id FROM customers WHERE company_id=${f.company}`).toHaveLength(1);
  for (const code of ['create:customers:business', 'manage:discount-limits:business']) {
    expect((await save(f, f.managerMember, { permission_code: code })).body['code']).toBe(
      'PERMISSION_SCOPE_OUTSIDE_REACH',
    );
    const id = await seedOverride(f, f.managerMember, { permission_code: code });
    expect(envelope(await post(businessPath(f.otherBusiness), payload))).toEqual(unknown);
    await f.h
      .owner`UPDATE permission_overrides SET expires_at=now() WHERE company_id=${f.company} AND id=${id}`;
  }
});

it('GM creates through the company route by default; Viewer requires an explicit personal ALLOW', async () => {
  const customer = {
    ...payload,
    phone: { calling_code: '1', national_number: '2025550131' },
  };
  await actorRole('general_manager');
  const created = await post('/v1/customers/find-or-create', customer);
  expect(created.status).toBe(200);
  expect(created.body['phone']).toBe('***131');
  const viewerCustomer = {
    ...payload,
    phone: { calling_code: '1', national_number: '2025550132' },
  };
  await actorRole('viewer');
  expect((await post('/v1/customers/find-or-create', viewerCustomer)).status).toBe(403);
  const allowed = await save(f, f.managerMember, {
    permission_code: 'create:customers:company',
  });
  expect(allowed.status).toBe(201);
  const viewerCreated = await post('/v1/customers/find-or-create', viewerCustomer);
  expect(viewerCreated.status).toBe(200);
  expect(viewerCreated.body['phone']).toBe('***132');
  expect(viewerCreated.body['id']).not.toBe(created.body['id']);
  expect((await revoke(f, f.managerMember, String(allowed.body['id']))).status).toBe(200);
  expect((await post('/v1/customers/find-or-create', viewerCustomer)).status).toBe(403);
});

it('BM administers own business and branches; inaccessible targets are oracle-equal and self is protected', async () => {
  await actorRole('business_manager');
  const business = await scopedMember('BUSINESS', f.business);
  const branch = await scopedMember('BRANCH', f.branch);
  for (const id of [business, branch]) expect((await post(limitPath(id), limit)).status).toBe(200);
  const unknown = envelope(await post(limitPath(f.ids.newId()), limit));
  expect(unknown.status).toBe(403);
  for (const id of [
    await scopedMember('BUSINESS', f.otherBusiness),
    await scopedMember('BRANCH', otherBranch),
    await newMember(f),
    await newMember(f, 'viewer', f.otherCompany),
  ])
    expect(envelope(await post(limitPath(id), limit))).toEqual(unknown);
  expect((await post(limitPath(f.managerMember), limit)).body['code']).toBe('PERMISSION_SELF_EDIT');
  const sibling = await newHeldMember(f, { userId: f.managerId });
  await f.h.owner`UPDATE memberships SET scope_type='BUSINESS',scope_id=${f.business}
    WHERE company_id=${f.company} AND id=${sibling}`;
  expect((await post(limitPath(sibling), limit)).body['code']).toBe('PERMISSION_SELF_EDIT');
  await f.h
    .owner`UPDATE memberships SET ends_at=now() WHERE company_id=${f.company} AND id=${sibling}`;
  const detail = (id: string) =>
    getMembershipPermissions(
      f.db,
      { companyId: f.company, userId: f.managerId, businessId: f.business },
      id,
      { limit: 20 },
    );
  expect(await detail(branch)).toMatchObject({
    editing_enabled: false,
    discount_limit_editing_enabled: true,
  });
  expect(await detail(f.managerMember)).toMatchObject({ discount_limit_editing_enabled: false });
  const deny = await seedOverride(f, f.managerMember, {
    permission_code: 'manage:discount-limits:business',
    effect: 'DENY',
    scope_type: 'BRANCH',
    scope_id: f.branch,
  });
  expect(envelope(await post(limitPath(business), limit))).toEqual(unknown);
  expect((await post(limitPath(branch), limit)).status).toBe(403);
  expect(await detail(branch)).toMatchObject({ discount_limit_editing_enabled: false });
  await f.h
    .owner`UPDATE permission_overrides SET expires_at=now() WHERE company_id=${f.company} AND id=${deny}`;
  expect((await post(limitPath(business), limit)).status).toBe(200);
});

it('malformed broader system memberships cannot widen the new default grants', async () => {
  for (const role of ['business_manager', 'cashier', 'branch_manager']) {
    await actorRole(role);
    await f.h.owner`UPDATE memberships SET scope_type='COMPANY',scope_id=${f.company}
      WHERE company_id=${f.company} AND id=${f.managerMember}`;
    expect(
      (
        await post(
          role === 'business_manager' ? businessPath(f.business) : branchPath(f.branch),
          payload,
        )
      ).status,
    ).toBe(403);
    if (role === 'business_manager')
      expect((await post(limitPath(await newMember(f)), limit)).status).toBe(403);
  }
});

it('GM and Owner use the existing parameter route without membership administration grants', async () => {
  await actorRole('general_manager');
  for (const id of [await newMember(f), await scopedMember('BUSINESS', f.otherBusiness)])
    expect((await post(limitPath(id), limit)).status).toBe(200);
  expect((await post(limitPath(f.ownMember), limit)).body['code']).toBe(
    'PERMISSION_OWNER_PROTECTED',
  );
  const member = await newMember(f);
  expect((await post(limitPath(member), limit, f.cookie)).status).toBe(200);
  expect((await post(limitPath(f.ownMember), limit, f.cookie)).body['code']).toBe(
    'PERMISSION_SELF_EDIT',
  );
});

it('Device never-cells refuse new ALLOWs, historical ALLOWs remain inert, and staff login still works', async () => {
  await actorRole('device');
  const deviceRole = SYSTEM_ROLES.find((r) => r.code === 'device')?.id ?? '';
  const never = PERMISSIONS.filter(
    (p) =>
      !systemRolePolicy(deviceRole, 'global')?.permissions.includes(p) && !p.endsWith(':platform'),
  );
  const ids: string[] = [];
  for (const permission_code of never) {
    expect((await save(f, f.managerMember, { permission_code })).body['code']).toBe(
      'PERMISSION_ROLE_FORBIDDEN',
    );
    ids.push(await seedOverride(f, f.managerMember, { permission_code }));
  }
  const before = await f.h
    .owner`SELECT * FROM permission_overrides WHERE company_id=${f.company} AND id=ANY(${ids}::uuid[]) ORDER BY id`;
  const authorize = new AuthorizeRequest(createAccessReader(f.db));
  for (const permission of never)
    expect(
      await authorize.execute({
        userId: f.managerId,
        requestedCompany: f.company,
        permission,
        ...(permission.endsWith(':branch')
          ? { branchParam: f.branch }
          : permission.endsWith(':business')
            ? { businessParam: f.business }
            : {}),
      }),
    ).toBeNull();
  expect((await post(branchPath(f.branch), payload)).status).toBe(403);
  expect((await post(limitPath(await scopedMember('BRANCH', f.branch)), limit)).status).toBe(403);
  expect(
    await f.h
      .owner`SELECT * FROM permission_overrides WHERE company_id=${f.company} AND id=ANY(${ids}::uuid[]) ORDER BY id`,
  ).toEqual(before);
  await seedOverride(f, f.managerMember, {
    permission_code: 'login:staff:branch',
    scope_type: 'BRANCH',
    scope_id: f.branch,
  });
  expect(
    await authorize.execute({
      userId: f.managerId,
      requestedCompany: f.company,
      permission: 'login:staff:branch',
      branchParam: f.branch,
    }),
  ).not.toBeNull();
});

it('0059 applies to an existing company idempotently without changing personal history or memberships', async () => {
  const members = await f.h.owner`SELECT * FROM memberships ORDER BY company_id,id`;
  const history = await f.h.owner`SELECT * FROM permission_overrides ORDER BY company_id,id`;
  const migration = readFileSync(
    new URL(
      '../../../../../../packages/db/migrations/0059_2026-10-03_identity-role-followups.sql',
      import.meta.url,
    ),
    'utf8',
  );
  await f.h.owner`DELETE FROM role_permissions WHERE role_owner_key='global' AND permission_code IN
    ('create:customers:business','create:customers:branch','manage:discount-limits:business')`;
  const gmRole = SYSTEM_ROLES.find((r) => r.code === 'general_manager')?.id ?? '';
  await f.h.owner`DELETE FROM role_permissions WHERE role_owner_key='global'
    AND role_id=${gmRole} AND permission_code='create:customers:company'`;
  for (let i = 0; i < 2; i++)
    await f.h.owner.begin(async (tx) => {
      for (const statement of migration.split('--> statement-breakpoint'))
        await tx.unsafe(statement);
    });
  expect(await f.h.owner`SELECT * FROM memberships ORDER BY company_id,id`).toEqual(members);
  expect(await f.h.owner`SELECT * FROM permission_overrides ORDER BY company_id,id`).toEqual(
    history,
  );
  expect(
    await f.h
      .owner`SELECT permission_code, count(*)::int AS n FROM role_permissions WHERE role_owner_key='global'
    AND permission_code IN ('create:customers:company','create:customers:business','create:customers:branch','manage:discount-limits:business')
    GROUP BY permission_code ORDER BY permission_code`,
  ).toEqual([
    { permission_code: 'create:customers:branch', n: 3 },
    { permission_code: 'create:customers:business', n: 2 },
    { permission_code: 'create:customers:company', n: 2 },
    { permission_code: 'manage:discount-limits:business', n: 3 },
  ]);
});
