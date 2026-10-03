import {
  membershipPermissions,
  permissionMembershipPage,
  permissionOverride,
} from '@pospay/contracts';
import type { TenantWrappers, Tx } from '@pospay/db';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { getMembershipPermissions } from '../queries/membership-permissions.query.ts';
import { listPermissionMemberships } from '../queries/permission-memberships.query.ts';
import { createPermissionOverrideTransactions } from '../persistence/permission-override-transactions.ts';
import { createGrantInvalidator } from '../persistence/grant-invalidator.ts';
import { createAccessReader } from '../persistence/access-reader.ts';
import { GrantPermissionOverride } from '../use-cases/grant-permission-override/grant-permission-override.ts';
import { AuthorizeRequest } from '../use-cases/authorize-request/authorize-request.ts';
import {
  newMember,
  permissionFixture,
  revoke,
  save,
  seedOverride,
  terms,
  type PermissionFixture,
} from './permissions-screen.fixture.ts';

let f: PermissionFixture;
let member: string;
beforeAll(async () => {
  f = await permissionFixture();
  member = await newMember(f);
  for (const permission_code of ['manage:memberships:company', 'read:memberships:company'])
    await seedOverride(f, f.managerMember, { permission_code });
});
afterAll(async () => {
  if (f) {
    await f.db.close();
    await f.h.close();
  }
});
const get = (path: string, cookie = f.cookie) =>
  f.h.send('GET', `/v1/permissions/memberships${path}`, { cookie, company: f.company });
const countAudits = async () => {
  const [row] = await f.h
    .owner`SELECT count(*) AS n FROM audit_log WHERE entity = 'permission_override'`;
  return Number(row?.['n']);
};
const version = () => f.h.redis.get(`identity:grants:${f.company}:version`);

it('returns stored defaults, excludes platform catalog and allows editing only for a current manager of someone else', async () => {
  const detail = membershipPermissions.parse((await get(`/${member}`)).body);
  expect(detail.membership.employee_id).toBeTruthy();
  expect(detail.role_defaults).toEqual([]);
  expect(detail.permission_catalog).not.toContain('create:companies:platform');
  expect(detail.editing_enabled).toBe(true);
  expect(membershipPermissions.parse((await get(`/${f.ownMember}`)).body).editing_enabled).toBe(
    false,
  );
  expect(
    membershipPermissions.parse((await get(`/${f.managerMember}`, f.managerCookie)).body)
      .editing_enabled,
  ).toBe(false);
  const owner = membershipPermissions.parse((await get(`/${f.ownMember}`)).body);
  expect(owner.role_defaults).toContain('manage:memberships:company');
});
it('paginates memberships and validates both cursors', async () => {
  const first = permissionMembershipPage.parse((await get('?limit=1')).body);
  const second = permissionMembershipPage.parse(
    (await get(`?limit=1&cursor=${first.next_cursor}`)).body,
  );
  expect(first.items[0]?.id).not.toBe(second.items[0]?.id);
  expect((await get('?cursor=bad')).status).toBe(400);
  expect((await get(`/${member}?history_cursor=bad`)).status).toBe(400);
});
it('requires authentication, current management and read permission', async () => {
  expect((await get('', '')).status).toBe(401);
  const deny = await seedOverride(f, f.managerMember, {
    permission_code: 'manage:memberships:company',
    effect: 'DENY',
  });
  expect((await save(f, member, {}, f.managerCookie)).status).toBe(403);
  expect(
    membershipPermissions.parse((await get(`/${member}`, f.managerCookie)).body).editing_enabled,
  ).toBe(false);
  await f.h
    .owner`UPDATE permission_overrides SET expires_at = now() WHERE company_id = ${f.company} AND id = ${deny}`;
  const readDeny = await seedOverride(f, f.managerMember, {
    permission_code: 'read:memberships:company',
    effect: 'DENY',
  });
  expect((await get('', f.managerCookie)).status).toBe(403);
  await f.h
    .owner`UPDATE permission_overrides SET expires_at = now() WHERE company_id = ${f.company} AND id = ${readDeny}`;
});

it('keeps audit and history for all three operations and invalidates company and membership versions', async () => {
  const id = await newMember(f);
  const prior = Number(await version());
  const created = await save(f, id);
  expect(created.status).toBe(201);
  const first = permissionOverride.parse(created.body);
  const replaced = await save(f, id, { effect: 'DENY', reason: 'Synthetic replace' });
  expect(replaced.status).toBe(201);
  const second = permissionOverride.parse(replaced.body);
  const ended = await revoke(f, id, second.id);
  expect(ended.status).toBe(200);
  expect((await revoke(f, id, second.id)).body['code']).toBe('PERMISSION_OVERRIDE_ENDED');
  expect(Number(await version())).toBe(prior + 3);
  expect(await f.h.redis.get(`identity:grants:${f.company}:membership:${id}:version`)).toBe('3');
  const audits = await f.h.owner`SELECT actor_user_id, action, before, after FROM audit_log
      WHERE entity_id IN (${first.id}, ${second.id}) ORDER BY at, id`;
  expect(audits.map((a) => a['action'])).toEqual([
    'permission.granted',
    'permission.replaced',
    'permission.revoked',
  ]);
  expect(audits.every((a) => a['actor_user_id'] === f.userId)).toBe(true);
  expect(audits[1]?.['before']).toMatchObject([
    { id: first.id, effect: 'ALLOW', membership_id: id },
  ]);
  expect(audits[1]?.['after']).toMatchObject({
    effect: 'DENY',
    reason: 'Synthetic replace',
    membership_id: id,
  });
  expect(audits[2]?.['after']).toMatchObject({ reason: 'Synthetic revoke', scope_id: f.company });
  const detail = membershipPermissions.parse((await get(`/${id}?limit=1`)).body);
  expect(detail.overrides.items).toHaveLength(0);
  expect(detail.ended_overrides.items).toHaveLength(1);
  const next = membershipPermissions.parse(
    (await get(`/${id}?limit=1&history_cursor=${detail.ended_overrides.next_cursor}`)).body,
  );
  expect(next.ended_overrides.items[0]?.id).not.toBe(detail.ended_overrides.items[0]?.id);
  expect(next.ended_overrides.next_cursor).toBeNull();
});
it('allows ALLOW/DENY at company, business and branch scopes and only replaces the identical key', async () => {
  const id = await newMember(f);
  for (const [scope_type, scope_id] of [
    ['COMPANY', f.company],
    ['BUSINESS', f.business],
    ['BRANCH', f.branch],
  ] as const) {
    expect((await save(f, id, { scope_type, scope_id, effect: 'DENY' })).status).toBe(201);
    expect((await save(f, id, { scope_type, scope_id, effect: 'ALLOW' })).status).toBe(201);
  }
  const detail = membershipPermissions.parse((await get(`/${id}`)).body);
  expect(detail.overrides.items).toHaveLength(3);
  expect(detail.ended_overrides.items).toHaveLength(3);
  expect(detail.overrides.items.every((o) => o.effect === 'ALLOW')).toBe(true);
});
it('treats naturally expired overrides as ended and requires a valid revoke reason', async () => {
  const id = await newMember(f);
  const old = await seedOverride(f, id, { expires_at: '2020-01-01T00:00:00Z' });
  expect((await revoke(f, id, old)).status).toBe(409);
  expect((await revoke(f, id, old, f.cookie, ' ')).status).toBe(400);
  expect((await revoke(f, id, old, f.cookie, 'x'.repeat(501))).status).toBe(400);
  expect((await save(f, id)).status).toBe(201);
  const detail = membershipPermissions.parse((await get(`/${id}`)).body);
  expect(detail.overrides.items).toHaveLength(1);
  expect(detail.ended_overrides.items[0]?.id).toBe(old);
});
it('serializes concurrent replacements without stacking current rows', async () => {
  const id = await newMember(f);
  const results = await Promise.all([save(f, id), save(f, id, { effect: 'DENY' })]);
  expect(results.map((r) => r.status)).toEqual([201, 201]);
  const detail = membershipPermissions.parse((await get(`/${id}`)).body);
  expect(detail.overrides.items).toHaveLength(1);
  expect(detail.ended_overrides.items).toHaveLength(1);
  expect(detail.ended_overrides.items[0]?.expires_at).toBe(detail.overrides.items[0]?.granted_at);
});

it('refuses self create, replacement and revoke with no audit or invalidation', async () => {
  const old = await seedOverride(f, f.ownMember);
  const audits = await countAudits();
  const prior = await version();
  expect(
    (await save(f, f.ownMember, { permission_code: 'read:branches:branch' })).body['code'],
  ).toBe('PERMISSION_SELF_EDIT');
  expect((await save(f, f.ownMember)).body['code']).toBe('PERMISSION_SELF_EDIT');
  expect((await revoke(f, f.ownMember, old)).body['code']).toBe('PERMISSION_SELF_EDIT');
  expect(await countAudits()).toBe(audits);
  expect(await version()).toBe(prior);
});
it('protects owner DENY additions and ALLOW replacement/revocation, but allows new owner ALLOW', async () => {
  const id = await newMember(f, 'owner');
  expect((await save(f, id, { effect: 'DENY' })).body['code']).toBe('PERMISSION_OWNER_PROTECTED');
  const first = permissionOverride.parse((await save(f, id)).body);
  expect((await save(f, id)).body['code']).toBe('PERMISSION_OWNER_PROTECTED');
  expect((await revoke(f, id, first.id)).body['code']).toBe('PERMISSION_OWNER_PROTECTED');
  const legacyDeny = await seedOverride(f, id, {
    effect: 'DENY',
    permission_code: 'read:branches:branch',
  });
  expect((await revoke(f, id, legacyDeny)).status).toBe(200);
});
it('refuses a permission the editor does not hold, applies expiry, and names scope outside reach', async () => {
  expect((await save(f, member, {}, f.managerCookie)).body['code']).toBe('PERMISSION_NOT_HELD');
  const scoped = await seedOverride(f, f.managerMember, {
    scope_type: 'BUSINESS',
    scope_id: f.business,
  });
  expect(
    (await save(f, member, { scope_type: 'BRANCH', scope_id: f.branch }, f.managerCookie)).status,
  ).toBe(201);
  expect(
    (await save(f, member, { scope_type: 'BUSINESS', scope_id: f.otherBusiness }, f.managerCookie))
      .body['code'],
  ).toBe('PERMISSION_SCOPE_OUTSIDE_REACH');
  await f.h
    .owner`UPDATE permission_overrides SET expires_at = now() WHERE company_id = ${f.company} AND id = ${scoped}`;
  expect(
    (await save(f, member, { scope_type: 'BRANCH', scope_id: f.branch }, f.managerCookie)).body[
      'code'
    ],
  ).toBe('PERMISSION_NOT_HELD');
});
it('applies editor DENY at the target and under a broader grant', async () => {
  const allow = await seedOverride(f, f.managerMember);
  const deny = await seedOverride(f, f.managerMember, {
    effect: 'DENY',
    scope_type: 'BRANCH',
    scope_id: f.branch,
  });
  for (const [scope_type, scope_id] of [
    ['COMPANY', f.company],
    ['BUSINESS', f.business],
    ['BRANCH', f.branch],
  ] as const)
    expect((await save(f, member, { scope_type, scope_id }, f.managerCookie)).body['code']).toBe(
      'PERMISSION_NOT_HELD',
    );
  expect(
    (await save(f, member, { scope_type: 'BRANCH', scope_id: f.siblingBranch }, f.managerCookie))
      .status,
  ).toBe(201);
  await f.h
    .owner`UPDATE permission_overrides SET expires_at = now() WHERE company_id = ${f.company} AND id IN (${allow}, ${deny})`;
});
it('refuses cross-tenant membership/scope/override and nonexistent rows without touching another company', async () => {
  const foreign = await newMember(f, 'viewer', f.otherCompany);
  expect((await get(`/${foreign}`)).status).toBe(404);
  expect((await save(f, foreign)).status).toBe(403);
  expect((await save(f, member, { scope_type: 'BRANCH', scope_id: f.foreignBranch })).status).toBe(
    403,
  );
  expect((await save(f, member, { scope_id: f.otherCompany })).status).toBe(403);
  expect((await revoke(f, foreign, f.ids.newId())).status).toBe(404);
  const ownOverride = await seedOverride(f, member);
  expect((await revoke(f, foreign, ownOverride)).status).toBe(404);
  const [row] = await f.h
    .owner`SELECT count(*) AS n FROM permission_overrides WHERE company_id = ${f.otherCompany}`;
  expect(Number(row?.['n'])).toBe(0);
});
it('reloads management and edited grants in the transaction after an earlier guard check', async () => {
  const authorize = new AuthorizeRequest(createAccessReader(f.db));
  expect(
    await authorize.execute({
      userId: f.userId,
      requestedCompany: f.company,
      permission: 'manage:memberships:company',
    }),
  ).not.toBeNull();
  const deny = await seedOverride(f, f.ownMember, { effect: 'DENY' });
  const grant = new GrantPermissionOverride(
    createPermissionOverrideTransactions(f.db, f.ids),
    createGrantInvalidator(f.h.redis),
  );
  await expect(
    grant.execute({ companyId: f.company, userId: f.userId }, member, terms(f)),
  ).rejects.toMatchObject({ code: 'PERMISSION_NOT_HELD' });
  await f.h
    .owner`UPDATE permission_overrides SET expires_at = now() WHERE company_id = ${f.company} AND id = ${deny}`;
  const manageDeny = await seedOverride(f, f.ownMember, {
    effect: 'DENY',
    permission_code: 'manage:memberships:company',
  });
  await expect(
    grant.execute({ companyId: f.company, userId: f.userId }, member, terms(f)),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await f.h
    .owner`UPDATE permission_overrides SET expires_at = now() WHERE company_id = ${f.company} AND id = ${manageDeny}`;
});

it('rolls replacement back when audit fails, preserving the old current decision and cache version', async () => {
  const id = await newMember(f);
  const old = await seedOverride(f, id);
  const prior = await version();
  const transactions = createPermissionOverrideTransactions(f.db, f.ids);
  const invalidate = vi.fn();
  const grant = new GrantPermissionOverride(
    {
      run: (companyId, userId, work) =>
        transactions.run(companyId, userId, (scope) =>
          work({
            ...scope,
            audit: {
              record: async () => {
                throw new Error('synthetic audit failure');
              },
            },
          }),
        ),
    },
    { invalidate },
  );
  await expect(
    grant.execute({ companyId: f.company, userId: f.userId }, id, terms(f, { effect: 'DENY' })),
  ).rejects.toThrow('synthetic audit failure');
  const detail = membershipPermissions.parse((await get(`/${id}`)).body);
  expect(detail.overrides.items.map((o) => o.id)).toEqual([old]);
  expect(detail.ended_overrides.items).toHaveLength(0);
  expect(invalidate).not.toHaveBeenCalled();
  expect(await version()).toBe(prior);
});
it('AuthorizeRequest observes created ALLOW, replacement DENY and revoke immediately', async () => {
  const authorize = new AuthorizeRequest(createAccessReader(f.db));
  const input = {
    userId: f.managerId,
    requestedCompany: f.company,
    permission: 'read:settings:business',
    businessParam: f.business,
  };
  expect(await authorize.execute(input)).toBeNull();
  expect(
    (await save(f, f.managerMember, { scope_type: 'BUSINESS', scope_id: f.business })).status,
  ).toBe(201);
  expect(await authorize.execute(input)).not.toBeNull();
  const denied = permissionOverride.parse(
    (
      await save(f, f.managerMember, {
        effect: 'DENY',
        scope_type: 'BUSINESS',
        scope_id: f.business,
      })
    ).body,
  );
  expect(await authorize.execute(input)).toBeNull();
  expect((await revoke(f, f.managerMember, denied.id)).status).toBe(200);
  expect(await authorize.execute(input)).toBeNull();
});

function explaining(db: TenantWrappers, plans: string[]): TenantWrappers {
  return {
    ...db,
    withTenant: (company, work, options) =>
      db.withTenant(
        company,
        async (tx) => {
          await tx.execute(sql`SET LOCAL enable_seqscan = off`);
          const proxy = new Proxy(tx, {
            get: (target, property, receiver) =>
              property === 'execute'
                ? async (query: SQL) => {
                    plans.push(
                      JSON.stringify(
                        await target.execute(sql`EXPLAIN (ANALYZE, FORMAT JSON) ${query}`),
                      ),
                    );
                    return target.execute(query);
                  }
                : Reflect.get(target, property, receiver),
          });
          return work(proxy as Tx);
        },
        options,
      ),
  };
}
it('uses existing indexes for list, current/history detail and editing availability', async () => {
  const plans: string[] = [];
  const actor = { companyId: f.company, userId: f.userId };
  await listPermissionMemberships(explaining(f.db, plans), actor, { limit: 20 });
  await getMembershipPermissions(explaining(f.db, plans), actor, member, { limit: 20 });
  expect(plans[0]).toMatch(/memberships_(pkey|scope_\w+_idx)/);
  expect(plans[1]).toMatch(/permission_overrides_(membership_idx|pkey)/);
  expect(plans[1]).toContain('memberships_pkey');
  expect(plans.join('')).not.toContain('Seq Scan');
});
