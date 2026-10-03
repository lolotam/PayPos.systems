import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { SYSTEM_ROLES, systemRoleOverrideAllowedSql } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { AuthorizeRequest } from '../use-cases/authorize-request/authorize-request.ts';
import { createAccessReader } from '../persistence/access-reader.ts';
import { readMembershipDiscountSubject } from '../queries/membership-discount-limit.query.ts';
import { getMembershipPermissions } from '../queries/membership-permissions.query.ts';
import {
  newMember,
  permissionFixture,
  save,
  seedOverride,
  terms,
  type PermissionFixture,
} from './permissions-screen.fixture.ts';

let f: PermissionFixture;
beforeAll(async () => {
  f = await permissionFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
async function actorRole(code: string) {
  const id = SYSTEM_ROLES.find((r) => r.code === code)?.id ?? '';
  const business = code === 'business_manager';
  await f.h
    .owner`UPDATE memberships SET role_id=${id},role_owner_key='global',scope_type=${business ? 'BUSINESS' : 'COMPANY'},scope_id=${business ? f.business : f.company}
    WHERE company_id=${f.company} AND id=${f.managerMember}`;
}
function authorize(permission: string, businessParam?: string, branchParam?: string) {
  return new AuthorizeRequest(createAccessReader(f.db)).execute({
    userId: f.managerId,
    requestedCompany: f.company,
    permission,
    ...(businessParam === undefined ? {} : { businessParam }),
    ...(branchParam === undefined ? {} : { branchParam }),
  });
}
const send = (method: 'GET' | 'POST', path: string, body?: object) =>
  f.h.send(method, path, {
    cookie: f.managerCookie,
    company: f.company,
    ...(body === undefined ? {} : { body }),
  });
const businessPath = () => `/v1/businesses/${f.business}/permissions/memberships`;

it('a custom owner name has no immunity in access, editing availability or locked holder protection', async () => {
  const role = f.ids.newId();
  await f.h
    .owner`INSERT INTO roles(id,company_id,code,name_en) VALUES (${role},${f.company},'owner','Synthetic custom owner')`;
  for (const permission of [
    'read:files:business',
    'read:memberships:company',
    'manage:memberships:company',
  ])
    await f.h
      .owner`INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code) VALUES (${role},${f.company},${f.company},${permission})`;
  await f.h
    .owner`UPDATE memberships SET role_id=${role},role_owner_key=${f.company} WHERE company_id=${f.company} AND id=${f.managerMember}`;
  await seedOverride(f, f.managerMember, {
    permission_code: 'read:files:business',
    effect: 'DENY',
    scope_type: 'BUSINESS',
    scope_id: f.business,
  });
  await seedOverride(f, f.managerMember, {
    permission_code: 'manage:memberships:company',
    effect: 'DENY',
  });
  expect(await authorize('read:files:business', f.business)).toBeNull();
  expect(await authorize('read:files:business', f.otherBusiness)).not.toBeNull();
  const target = await newMember(f);
  expect(
    (
      await getMembershipPermissions(f.db, { companyId: f.company, userId: f.managerId }, target, {
        limit: 20,
      })
    )?.editing_enabled,
  ).toBe(false);
  const denied = await save(f, f.managerMember, {
    permission_code: 'manage:files:business',
    effect: 'DENY',
    scope_type: 'BUSINESS',
    scope_id: f.business,
  });
  expect(denied.status).toBe(201);
  expect(
    (
      await f.h.send(
        'POST',
        `/v1/permissions/memberships/${f.managerMember}/overrides/${denied.body['id']}/revoke`,
        { cookie: f.cookie, company: f.company, body: { reason: 'Synthetic custom owner revoke' } },
      )
    ).status,
  ).toBe(200);
});
it('a custom owner name cannot bypass the discount subject policy', async () => {
  expect(
    await f.db.withTenant(f.company, (tx) =>
      readMembershipDiscountSubject(
        tx,
        f.company,
        f.managerMember,
        { businessId: f.business, branchIds: [f.branch] },
        new Date().toISOString(),
      ),
    ),
  ).toMatchObject({ status: 'FOUND', owner: false });
});
it('refuses forbidden Viewer and business-manager grants without writes; optional and read-only cells remain grantable', async () => {
  const viewer = await newMember(f, 'viewer');
  const manager = await newMember(f, 'business_manager');
  await f.h
    .owner`UPDATE memberships SET scope_type='BUSINESS',scope_id=${f.business} WHERE company_id=${f.company} AND id=${manager}`;
  const before = await f.h.owner`SELECT id FROM audit_log WHERE company_id=${f.company}`;
  for (const [member, permission_code] of [
    [viewer, 'manage:devices:branch'],
    [manager, 'manage:memberships:company'],
    [manager, 'read:memberships:company'],
  ] as const) {
    const response = await save(f, member, { permission_code });
    expect(response.status).toBe(403);
    expect(response.body['code']).toBe('PERMISSION_ROLE_FORBIDDEN');
    expect(response.body['message_ar']).toEqual(expect.any(String));
    expect(response.body['message_en']).toEqual(expect.any(String));
  }
  expect(await f.h.owner`SELECT id FROM audit_log WHERE company_id=${f.company}`).toEqual(before);
  expect((await save(f, viewer, { permission_code: 'read:branches:branch' })).status).toBe(201);
  const branchManager = await newMember(f, 'branch_manager');
  expect(
    (await save(f, branchManager, { scope_type: 'BUSINESS', scope_id: f.business })).status,
  ).toBe(201);
});
it('existing forbidden ALLOWs cannot open guards or onward delegation and remain in history', async () => {
  await actorRole('viewer');
  const viewerAllow = await seedOverride(f, f.managerMember, {
    permission_code: 'manage:devices:branch',
  });
  expect(await authorize('manage:devices:branch', undefined, f.branch)).toBeNull();
  const [viewerRow] = await f.h
    .owner`SELECT * FROM permission_overrides WHERE company_id=${f.company} AND id=${viewerAllow}`;
  expect(viewerRow).toMatchObject({ effect: 'ALLOW', expires_at: null });
  await actorRole('business_manager');
  const forbidden = await seedOverride(f, f.managerMember, {
    permission_code: 'manage:memberships:company',
  });
  expect(await authorize('manage:memberships:company')).toBeNull();
  expect((await save(f, await newMember(f), {}, f.managerCookie)).status).toBe(403);
  const [row] = await f.h
    .owner`SELECT * FROM permission_overrides WHERE company_id=${f.company} AND id=${forbidden}`;
  expect(row).toMatchObject({ effect: 'ALLOW', expires_at: null });
  await f.h
    .owner`UPDATE permission_overrides SET expires_at=now() WHERE company_id=${f.company} AND id IN (${viewerAllow},${forbidden})`;
});
it('scoped revoke, detail and grant return identical envelopes for inaccessible and unknown targets', async () => {
  await actorRole('business_manager');
  for (const permission_code of ['read:memberships:business', 'manage:memberships:business'])
    expect(
      (
        await save(f, f.managerMember, {
          permission_code,
          scope_type: 'BUSINESS',
          scope_id: f.business,
        })
      ).status,
    ).toBe(201);
  const own = await newMember(f),
    other = await newMember(f);
  await f.h
    .owner`UPDATE memberships SET scope_type='BUSINESS',scope_id=${f.business} WHERE company_id=${f.company} AND id=${own}`;
  await f.h
    .owner`UPDATE memberships SET scope_type='BUSINESS',scope_id=${f.otherBusiness} WHERE company_id=${f.company} AND id=${other}`;
  const otherDecision = await seedOverride(f, other, {
    scope_type: 'BUSINESS',
    scope_id: f.otherBusiness,
  });
  const hiddenDecision = await seedOverride(f, own, {
    scope_type: 'BUSINESS',
    scope_id: f.otherBusiness,
  });
  const companyDecision = await seedOverride(f, own);
  const absent = await send('POST', `${businessPath()}/${own}/overrides/${f.ids.newId()}/revoke`, {
    reason: 'Synthetic scope privacy',
  });
  expect(absent.status).toBe(404);
  for (const [member, id] of [
    [other, otherDecision],
    [own, hiddenDecision],
    [own, companyDecision],
  ]) {
    const response = await send('POST', `${businessPath()}/${member}/overrides/${id}/revoke`, {
      reason: 'Synthetic scope privacy',
    });
    expect({ status: response.status, body: response.body }).toEqual({
      status: absent.status,
      body: absent.body,
    });
  }
  const missing = f.ids.newId();
  for (const method of ['GET', 'POST'] as const) {
    const suffix = method === 'GET' ? '' : '/overrides';
    const body =
      method === 'GET' ? undefined : terms(f, { scope_type: 'BUSINESS', scope_id: f.business });
    const inaccessible = await send(method, `${businessPath()}/${other}${suffix}`, body);
    const unknown = await send(method, `${businessPath()}/${missing}${suffix}`, body);
    expect({ status: inaccessible.status, body: inaccessible.body }).toEqual({
      status: unknown.status,
      body: unknown.body,
    });
  }
});
it('the migrated existing company retains 3 forbidden ALLOW rows, all ignored without deleting history', async () => {
  const viewer = await newMember(f, 'viewer'),
    manager = await newMember(f, 'business_manager');
  await f.h
    .owner`UPDATE memberships SET scope_type='BUSINESS',scope_id=${f.business} WHERE company_id=${f.company} AND id=${manager}`;
  const ids = [
    await seedOverride(f, viewer, { permission_code: 'manage:devices:branch' }),
    await seedOverride(f, manager, { permission_code: 'manage:memberships:company' }),
    await seedOverride(f, manager, {
      permission_code: 'manage:memberships:business',
      scope_type: 'BUSINESS',
      scope_id: f.otherBusiness,
    }),
  ];
  const before = await f.h
    .owner`SELECT * FROM permission_overrides WHERE company_id=${f.company} ORDER BY id`;
  const migration = readFileSync(
    new URL(
      '../../../../../../packages/db/migrations/0054_2026-10-03_system-role-default-bundles.sql',
      import.meta.url,
    ),
    'utf8',
  );
  await f.h.owner.begin(async (tx) => {
    for (const statement of migration.split('--> statement-breakpoint')) await tx.unsafe(statement);
  });
  expect(
    Array.from(
      await f.h.owner`SELECT * FROM permission_overrides WHERE company_id=${f.company} ORDER BY id`,
    ),
  ).toEqual(Array.from(before));
  const count = await f.db.withTenant(f.company, async (tx) =>
    tx.execute<{
      n: string;
    }>(sql`SELECT count(*) AS n FROM permission_overrides o JOIN memberships m ON m.company_id=o.company_id AND m.id=o.membership_id
    WHERE o.company_id=${f.company} AND o.effect='ALLOW' AND (o.expires_at IS NULL OR o.expires_at>now()) AND NOT (${systemRoleOverrideAllowedSql('m', 'o')})`),
  );
  expect(Number(count[0]?.n)).toBe(3);
  const grants = await f.db.withTenant(f.company, (tx) =>
    tx.execute(sql`SELECT o.id FROM permission_overrides o JOIN memberships m ON m.company_id=o.company_id AND m.id=o.membership_id
    WHERE o.id IN (${sql.join(
      ids.map((id) => sql`${id}::uuid`),
      sql`,`,
    )}) AND ${systemRoleOverrideAllowedSql('m', 'o')}`),
  );
  expect(grants).toHaveLength(0);
});
