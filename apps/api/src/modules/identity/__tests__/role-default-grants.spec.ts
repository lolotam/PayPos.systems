import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { membershipPermissions, permissionMembershipPage } from '@pospay/contracts';
import {
  OWNER_DERIVED_PERMISSIONS,
  PERMISSIONS,
  SYSTEM_ROLES,
  type TenantWrappers,
} from '@pospay/db';
import { sql, type SQL } from 'drizzle-orm';
import { ROLE_DEFAULTS } from '../../../../../../packages/db/src/role-defaults.ts';
import { AuthorizeRequest } from '../use-cases/authorize-request/authorize-request.ts';
import { createAccessReader } from '../persistence/access-reader.ts';
import { getMembershipPermissions } from '../queries/membership-permissions.query.ts';
import { listPermissionMemberships } from '../queries/permission-memberships.query.ts';
import {
  permissionFixture,
  newMember,
  seedOverride,
  terms,
  type PermissionFixture,
} from './permissions-screen.fixture.ts';

let f: PermissionFixture;
let otherBranch: string;
let targetMember: string;
const companyRoles = ['owner', 'general_manager', 'accountant', 'viewer'];
beforeAll(async () => {
  f = await permissionFixture();
  otherBranch = f.ids.newId();
  await f.h.owner`INSERT INTO branches(company_id,id,business_id,name_en)
    VALUES (${f.company},${otherBranch},${f.otherBusiness},'Synthetic other branch')`;
  targetMember = await newMember(f);
  await f.h.owner`UPDATE memberships SET scope_type='BRANCH',scope_id=${f.branch}
    WHERE company_id=${f.company} AND id=${targetMember}`;
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
async function actorRole(code: string) {
  const roleId = SYSTEM_ROLES.find((r) => r.code === code)?.id ?? '';
  const scope = companyRoles.includes(code)
    ? 'COMPANY'
    : code === 'business_manager' || code === 'marketing'
      ? 'BUSINESS'
      : 'BRANCH';
  const scopeId = scope === 'COMPANY' ? f.company : scope === 'BUSINESS' ? f.business : f.branch;
  await f.h
    .owner`UPDATE memberships SET role_id=${roleId}, role_owner_key='global', scope_type=${scope}, scope_id=${scopeId}
    WHERE company_id=${f.company} AND id=${f.managerMember}`;
  return scope;
}
const request = (method: 'GET' | 'POST', path: string, body?: object) =>
  f.h.send(method, path, {
    cookie: f.managerCookie,
    company: f.company,
    ...(body === undefined ? {} : { body }),
  });
const businessPath = (businessId = f.business) =>
  `/v1/businesses/${businessId}/permissions/memberships`;

function expectedDefaults() {
  return PERMISSIONS.flatMap((permission_code) => {
    const roles: readonly string[] = ROLE_DEFAULTS[permission_code];
    return SYSTEM_ROLES.filter((r) => roles.includes(r.code)).map((r) => ({
      role_id: r.id,
      permission_code,
    }));
  }).sort(
    (a, b) =>
      a.permission_code.localeCompare(b.permission_code) || a.role_id.localeCompare(b.role_id),
  );
}

it.each(SYSTEM_ROLES.filter((r) => r.code !== 'device'))(
  '$code guards every catalog permission at its own scope and other business/branch',
  async ({ code }) => {
    const scope = await actorRole(code);
    const authorize = new AuthorizeRequest(createAccessReader(f.db));
    for (const permission of PERMISSIONS.filter((p) => !p.endsWith(':platform'))) {
      const defaults: readonly string[] = ROLE_DEFAULTS[permission];
      const suffix = permission.split(':')[2];
      const ownTarget =
        suffix === 'company'
          ? {}
          : suffix === 'business'
            ? { businessParam: f.business }
            : { branchParam: f.branch };
      const own = await authorize.execute({
        userId: f.managerId,
        requestedCompany: f.company,
        permission,
        ...ownTarget,
      });
      const defaultAllowed =
        defaults.includes(code) ||
        (code === 'owner' && (OWNER_DERIVED_PERMISSIONS as readonly string[]).includes(permission));
      const expected =
        defaultAllowed &&
        // الـ guard العام لا يثبت ملكية الموظف؛ الذات تمر من مسار الجلسة المتخصص فقط.
        suffix !== 'own' &&
        (suffix !== 'company' || scope === 'COMPANY') &&
        (suffix !== 'business' || scope !== 'BRANCH');
      expect(own !== null, `${code} ${permission}`).toBe(expected);
      if (suffix !== 'company') {
        const elsewhere = await authorize.execute({
          userId: f.managerId,
          requestedCompany: f.company,
          permission,
          ...(suffix === 'business'
            ? { businessParam: f.otherBusiness }
            : { branchParam: otherBranch }),
        });
        expect(elsewhere !== null, `${code} ${permission} other scope`).toBe(
          defaultAllowed && suffix !== 'own' && scope === 'COMPANY',
        );
      }
    }
    const allowed = (ROLE_DEFAULTS['read:branches:branch'] as readonly string[]).includes(code);
    expect((await request('GET', `/v1/branches/${f.branch}`)).status).toBe(allowed ? 200 : 403);
    expect((await request('GET', `/v1/branches/${otherBranch}`)).status).toBe(
      allowed && scope === 'COMPANY' ? 200 : 403,
    );
    expect((await request('GET', `/v1/branches/${f.foreignBranch}`)).status).toBe(403);
    expect((await request('GET', businessPath())).status).toBe(code === 'owner' ? 200 : 403);
  },
);
it('DENY beats manager defaults; expiry restores them; explicit ALLOW adds optional scoped management', async () => {
  await actorRole('business_manager');
  const deny = await seedOverride(f, f.managerMember, {
    permission_code: 'read:settings:business',
    effect: 'DENY',
    scope_type: 'BRANCH',
    scope_id: f.branch,
  });
  const authorize = new AuthorizeRequest(createAccessReader(f.db));
  const input = {
    userId: f.managerId,
    requestedCompany: f.company,
    permission: 'read:settings:business',
  };
  expect(await authorize.execute({ ...input, branchParam: f.branch })).toBeNull();
  expect(await authorize.execute({ ...input, branchParam: f.siblingBranch })).not.toBeNull();
  await f.h
    .owner`UPDATE permission_overrides SET expires_at=now() WHERE company_id=${f.company} AND id=${deny}`;
  expect(await authorize.execute({ ...input, branchParam: f.branch })).not.toBeNull();
  for (const permission_code of ['read:memberships:business', 'manage:memberships:business']) {
    const path = `/v1/permissions/memberships/${f.managerMember}/overrides`;
    for (const change of [{}, { scope_type: 'BUSINESS' as const, scope_id: f.otherBusiness }])
      expect(
        (
          await f.h.send('POST', path, {
            cookie: f.cookie,
            company: f.company,
            body: terms(f, { permission_code, ...change }),
          })
        ).body['code'],
      ).toBe('PERMISSION_SCOPE_OUTSIDE_REACH');
    expect(
      (
        await f.h.send('POST', path, {
          cookie: f.cookie,
          company: f.company,
          body: terms(f, { permission_code, scope_type: 'BUSINESS', scope_id: f.business }),
        })
      ).status,
    ).toBe(201);
  }
  expect((await request('GET', businessPath())).status).toBe(200);
  expect((await request('GET', businessPath(f.otherBusiness))).status).toBe(403);
  expect((await request('GET', '/v1/permissions/memberships')).status).toBe(403);
});
it('scoped reads paginate only own memberships and hide company/other-business members', async () => {
  const page = permissionMembershipPage.parse(
    (await request('GET', `${businessPath()}?limit=100`)).body,
  );
  expect(page.items.map((m) => m.id)).toEqual(
    expect.arrayContaining([targetMember, f.managerMember]),
  );
  expect(page.items.map((m) => m.id)).not.toContain(f.ownMember);
  expect((await request('GET', `${businessPath()}/${f.ownMember}`)).status).toBe(404);
  const other = await newMember(f);
  await f.h
    .owner`UPDATE memberships SET scope_type='BUSINESS',scope_id=${f.otherBusiness} WHERE company_id=${f.company} AND id=${other}`;
  expect((await request('GET', `${businessPath()}/${other}`)).status).toBe(404);
  const companyDeny = await seedOverride(f, targetMember, {
    permission_code: 'read:branches:branch',
    effect: 'DENY',
  });
  const unrelated = await seedOverride(f, targetMember, {
    permission_code: 'read:branches:branch',
    scope_type: 'BUSINESS',
    scope_id: f.otherBusiness,
  });
  const detail = membershipPermissions.parse(
    (await request('GET', `${businessPath()}/${targetMember}`)).body,
  );
  expect(detail.role_defaults).toEqual(['read:branches:branch', 'read:businesses:company']);
  expect(detail.editing_enabled).toBe(true);
  expect(detail.permission_catalog).toContain('manage:memberships:business');
  expect(detail.overrides.items.map((o) => o.id)).toContain(companyDeny);
  expect(detail.overrides.items.map((o) => o.id)).not.toContain(unrelated);
  expect(
    (
      await request('POST', `${businessPath()}/${targetMember}/overrides/${companyDeny}/revoke`, {
        reason: 'Synthetic forbidden company decision',
      })
    ).status,
  ).toBe(404);
});
it('scoped commands preserve audited lifecycle and cannot change company/other-business authority', async () => {
  const body = terms(f, { scope_type: 'BRANCH', scope_id: f.branch });
  const path = `${businessPath()}/${targetMember}/overrides`;
  const created = await request('POST', path, body);
  expect(created.status).toBe(201);
  const id = created.body['id'] as string;
  expect(
    (await request('POST', `${path}/${id}/revoke`, { reason: 'Synthetic scope revoke' })).status,
  ).toBe(200);
  expect((await request('POST', path, terms(f))).status).toBe(403);
  expect(
    (await request('POST', path, terms(f, { scope_type: 'BUSINESS', scope_id: f.otherBusiness })))
      .status,
  ).toBe(403);
  expect((await request('POST', `${businessPath()}/${f.ownMember}/overrides`, body)).status).toBe(
    403,
  );
  const self = await request('POST', `${businessPath()}/${f.managerMember}/overrides`, body);
  expect(self.body['code']).toBe('PERMISSION_SELF_EDIT');
  const audits = await f.h.owner`SELECT action FROM audit_log WHERE entity_id=${id} ORDER BY at,id`;
  expect(audits.map((r) => r['action'])).toEqual(['permission.granted', 'permission.revoked']);
});
it('rechecks scoped management DENY under locks and refuses unknown/cross-tenant business', async () => {
  const deny = await seedOverride(f, f.managerMember, {
    permission_code: 'manage:memberships:business',
    effect: 'DENY',
    scope_type: 'BRANCH',
    scope_id: f.branch,
  });
  expect(
    (
      await request(
        'POST',
        `${businessPath()}/${targetMember}/overrides`,
        terms(f, { scope_type: 'BRANCH', scope_id: f.branch }),
      )
    ).status,
  ).toBe(403);
  await f.h
    .owner`UPDATE permission_overrides SET expires_at=now() WHERE company_id=${f.company} AND id=${deny}`;
  expect((await request('GET', businessPath(f.ids.newId()))).status).toBe(403);
  const foreign = await f.h.owner`SELECT id FROM businesses WHERE company_id=${f.otherCompany}`;
  expect((await request('GET', businessPath(foreign[0]?.['id'] as string))).status).toBe(403);
});
it('historical DENY on an owner sibling cannot reduce authority; history stays visible', async () => {
  const deny = await seedOverride(f, f.ownMember, {
    permission_code: 'manage:memberships:company',
    effect: 'DENY',
  });
  const authorize = new AuthorizeRequest(createAccessReader(f.db));
  expect(
    await authorize.execute({
      userId: f.userId,
      requestedCompany: f.company,
      permission: 'manage:memberships:company',
    }),
  ).not.toBeNull();
  const [row] = await f.h
    .owner`SELECT effect,expires_at FROM permission_overrides WHERE company_id=${f.company} AND id=${deny}`;
  expect(row).toMatchObject({ effect: 'DENY', expires_at: null });
});
it('the reference migration upgrades a seeded existing company without changing personal decisions', async () => {
  const customRole = f.ids.newId();
  await f.h.owner`INSERT INTO roles (id,company_id,code,name_en)
    VALUES (${customRole},${f.company},'synthetic_custom','Synthetic custom')`;
  await f.h
    .owner`INSERT INTO role_permissions (role_id,role_owner_key,company_id,permission_code) VALUES
    (${customRole},${f.company},${f.company},'read:branches:branch'),
    ('01920000-0000-7000-8000-00000000010e','global',NULL,'read:branches:branch')`;
  const preserved = await f.h.owner`SELECT * FROM role_permissions WHERE role_owner_key <> 'global'
    OR role_id = '01920000-0000-7000-8000-00000000010e' ORDER BY role_id,permission_code`;
  const before = await f.h.owner`SELECT * FROM permission_overrides ORDER BY company_id,id`;
  const members = await f.h.owner`SELECT * FROM memberships ORDER BY company_id,id`;
  await f.h
    .owner`DELETE FROM role_permissions WHERE role_owner_key='global' AND permission_code IN ('manage:employees:business','manage:files:business','read:files:business')`;
  const migration = readFileSync(
    new URL(
      '../../../../../../packages/db/migrations/0058_2026-10-03_system-role-default-bundles.sql',
      import.meta.url,
    ),
    'utf8',
  );
  await f.h.owner.begin(async (tx) => {
    for (const statement of migration.split('--> statement-breakpoint')) await tx.unsafe(statement);
  });
  expect(
    Array.from(await f.h.owner`SELECT * FROM permission_overrides ORDER BY company_id,id`),
  ).toEqual(Array.from(before));
  expect(Array.from(await f.h.owner`SELECT * FROM memberships ORDER BY company_id,id`)).toEqual(
    Array.from(members),
  );
  expect(
    Array.from(
      await f.h.owner`SELECT * FROM role_permissions WHERE role_owner_key <> 'global'
    OR role_id = '01920000-0000-7000-8000-00000000010e' ORDER BY role_id,permission_code`,
    ),
  ).toEqual(Array.from(preserved));
  expect(
    Array.from(
      await f.h.owner`SELECT role_id,permission_code FROM role_permissions
    WHERE role_owner_key = 'global' AND role_id <> '01920000-0000-7000-8000-00000000010e'
    ORDER BY permission_code,role_id`,
    ),
  ).toEqual(expectedDefaults());
  const access = await createAccessReader(f.db).accessIn(f.company, f.managerId);
  expect(access.grants).toContainEqual(
    expect.objectContaining({
      permission: 'manage:employees:business',
      source: 'role',
      scopeId: f.business,
    }),
  );
});
it('scoped queries use membership/branch and override indexes with result shapes', async () => {
  const plans: string[] = [];
  const actor = { companyId: f.company, userId: f.managerId, businessId: f.business };
  const db: TenantWrappers = { ...f.db };
  db.withTenant = (company, work, options) =>
    f.db.withTenant(
      company,
      async (tx) => {
        await tx.execute(sql`SET LOCAL enable_seqscan=off`);
        const proxy = new Proxy(tx, {
          get: (target, key, receiver) =>
            key === 'execute'
              ? async (query: SQL) => {
                  plans.push(
                    JSON.stringify(
                      await target.execute(sql`EXPLAIN (ANALYZE,FORMAT JSON) ${query}`),
                    ),
                  );
                  return target.execute(query);
                }
              : Reflect.get(target, key, receiver),
        });
        return work(proxy);
      },
      options,
    );
  expect((await listPermissionMemberships(db, actor, { limit: 20 })).items.length).toBeGreaterThan(
    0,
  );
  expect(
    (await getMembershipPermissions(db, actor, targetMember, { limit: 20 }))?.membership.id,
  ).toBe(targetMember);
  expect(plans.join('')).toMatch(/memberships_(scope_\w+_idx|pkey)/);
  expect(plans.join('')).toMatch(/branches_\w+/);
  expect(plans.join('')).toContain('permission_overrides_membership_idx');
  expect(plans.join('')).not.toContain('Seq Scan');
});
