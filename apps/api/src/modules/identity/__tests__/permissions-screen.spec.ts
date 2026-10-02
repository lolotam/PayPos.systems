import { createDatabase, SYSTEM_ROLES, type TenantWrappers, type Tx } from '@pospay/db';
import { membershipPermissions, permissionMembershipPage } from '@pospay/contracts';
import { systemUuidV7 } from '@pospay/ids';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from '../../../../test/harness.ts';
import { getMembershipPermissions } from '../queries/membership-permissions.query.ts';
import { listPermissionMemberships } from '../queries/permission-memberships.query.ts';
import { createPermissionOverrideTransactions } from '../persistence/permission-override-transactions.ts';
import { createGrantInvalidator } from '../persistence/grant-invalidator.ts';

const ids = systemUuidV7();
const employeeId = ids.newId();
const memberA = ids.newId();
const memberB = ids.newId();
const viewerRole = SYSTEM_ROLES.find((role) => role.code === 'viewer')?.id ?? '';
let h: Harness;
let cookie: string;
let companyA: string;
let companyB: string;
let userId: string;

async function seed() {
  const [user] = await h.owner`SELECT id FROM "user" WHERE email = 'permissions@example.test'`;
  userId = user?.['id'] as string;
  for (const [company, membership] of [
    [companyA, memberA],
    [companyB, memberB],
  ] as const) {
    await h.owner`INSERT INTO memberships (company_id, id, employee_id, role_id, role_owner_key, scope_type, scope_id)
      VALUES (${company}, ${membership}, ${employeeId}, ${viewerRole}, 'global', 'COMPANY', ${company})`;
  }
  await h.owner`INSERT INTO permission_overrides (company_id, id, membership_id, permission_code, effect,
    scope_type, scope_id, reason, granted_by) VALUES (${companyA}, ${ids.newId()}, ${memberA},
      'read:memberships:company', 'DENY', 'COMPANY', ${companyA}, 'synthetic denial', ${userId})`;
}
beforeAll(async () => {
  h = await startHarness();
  cookie = await h.signedInOperator('permissions@example.test');
  companyA = await h.onboard(cookie, 'Permissions A');
  companyB = await h.onboard(cookie, 'Permissions B');
  await seed();
});
afterAll(async () => {
  if (h) await h.close();
});
const get = (path: string, company = companyA) =>
  h.send('GET', `/v1/permissions/memberships${path}`, { cookie, company });
const body = () => ({
  permission_code: 'read:memberships:company',
  effect: 'ALLOW',
  scope_type: 'COMPANY',
  scope_id: companyA,
  reason: 'synthetic change',
  expires_at: null,
});

describe('permission screen API', () => {
  it('returns stored roles and defaults, no platform catalog permission, and both holder kinds', async () => {
    const listed = await get('');
    expect(listed.status).toBe(200);
    expect(permissionMembershipPage.parse(listed.body).items.map((row) => row.id)).toContain(
      memberA,
    );
    const detail = await get(`/${memberA}`);
    expect(detail.status).toBe(200);
    const parsed = membershipPermissions.parse(detail.body);
    expect(parsed.membership.employee_id).toBe(employeeId);
    expect(parsed.role_defaults).toEqual([]);
    expect(parsed.permission_catalog.every((code) => !code.endsWith(':platform'))).toBe(true);
    expect(parsed.overrides.items[0]?.effect).toBe('DENY');
    expect(parsed.editing_enabled).toBe(false);
  });
  it('paginates without overlap and rejects malformed cursors', async () => {
    const first = permissionMembershipPage.parse((await get('?limit=1')).body);
    const second = permissionMembershipPage.parse(
      (await get(`?limit=1&cursor=${first.next_cursor}`)).body,
    );
    expect(first.items).toHaveLength(1);
    expect(second.items).toHaveLength(1);
    expect(first.items[0]?.id).not.toBe(second.items[0]?.id);
    expect((await get('?cursor=bad')).status).toBe(400);
  });
  it('does not expose another company’s membership or overrides', async () => {
    expect((await get(`/${memberB}`)).status).toBe(404);
    expect(
      permissionMembershipPage.parse((await get('')).body).items.some((row) => row.id === memberB),
    ).toBe(false);
  });
});

describe('permission API access checks', () => {
  it('requires a session and refuses writes pending the recorded owner decision with no audit or effect', async () => {
    expect(
      (await h.send('GET', '/v1/permissions/memberships', { cookie: '', company: companyA }))
        .status,
    ).toBe(401);
    const written = await h.send('POST', `/v1/permissions/memberships/${memberA}/overrides`, {
      cookie,
      company: companyA,
      body: body(),
    });
    expect(written.status).toBe(409);
    expect(written.body['code']).toBe('PERMISSION_POLICY_UNRESOLVED');
    const [count] =
      await h.owner`SELECT count(*) AS count FROM audit_log WHERE entity = 'permission_override'`;
    expect(Number(count?.['count'])).toBe(0);
  });
  it('a DENY of management wins over the owner role on the next request', async () => {
    const [membership] =
      await h.owner`SELECT id FROM memberships WHERE company_id = ${companyB} AND user_id = ${userId}`;
    await h.owner`INSERT INTO permission_overrides (company_id, id, membership_id, permission_code, effect,
      scope_type, scope_id, reason, granted_by) VALUES (${companyB}, ${ids.newId()}, ${membership?.['id'] as string},
        'manage:memberships:company', 'DENY', 'COMPANY', ${companyB}, 'synthetic denial', ${userId})`;
    expect(
      (
        await h.send('POST', `/v1/permissions/memberships/${memberB}/overrides`, {
          cookie,
          company: companyB,
          body: { ...body(), scope_id: companyB },
        })
      ).status,
    ).toBe(403);
    expect((await get('', companyB)).status).toBe(200);
  });
});

describe('permission persistence and invalidation', () => {
  it('keeps insert and audit atomic, serializes duplicate writes, and advances the company grants version', async () => {
    const db = createDatabase({ url: h.urls.app, ids });
    const txs = createPermissionOverrideTransactions(db, ids);
    const terms = {
      ...body(),
      effect: 'ALLOW' as const,
      scope_type: 'COMPANY' as const,
      permission_code: 'read:businesses:company',
    };
    const save = () =>
      txs.run(companyA, userId, async (scope) => {
        await scope.context(memberA, terms, new Date());
        const saved = await scope.insert(memberA, terms, new Date());
        if (saved)
          await scope.audit.record({
            entity: 'permission_override',
            entityId: saved?.id ?? '',
            action: 'permission.granted',
            before: null,
            after: { ...saved, membership_id: memberA },
          });
        return saved;
      });
    try {
      const results = await Promise.all([save(), save()]);
      expect(results.filter(Boolean)).toHaveLength(1);
      const saved = results.find(Boolean);
      const [audit] =
        await h.owner`SELECT actor_user_id, after FROM audit_log WHERE entity_id = ${saved?.id ?? ''}`;
      expect(audit?.['actor_user_id']).toBe(userId);
      expect(audit?.['after']).toMatchObject({ effect: 'ALLOW', membership_id: memberA });
      const versionKey = `identity:grants:${companyA}:version`;
      await createGrantInvalidator(h.redis).invalidate(companyA);
      expect(await h.redis.get(versionKey)).toBe('1');
      await expect(
        txs.run(companyA, userId, async (scope) => {
          const terms2 = { ...terms, permission_code: 'create:businesses:company' };
          await scope.context(memberA, terms2, new Date());
          const inserted = await scope.insert(memberA, terms2, new Date());
          await scope.audit.record({
            entity: 'permission_override',
            entityId: inserted?.id ?? '',
            action: 'permission.granted',
          });
          throw new Error('rollback proof');
        }),
      ).rejects.toThrow('rollback proof');
      const [count] =
        await h.owner`SELECT count(*) AS n FROM permission_overrides WHERE membership_id = ${memberA}
        AND permission_code = 'create:businesses:company'`;
      expect(Number(count?.['n'])).toBe(0);
    } finally {
      await db.close();
    }
  });
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
                    const rows = await target.execute(sql`EXPLAIN (ANALYZE, FORMAT JSON) ${query}`);
                    plans.push(JSON.stringify(rows));
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
describe('permission query plans', () => {
  it('uses existing membership and override indexes for both query files', async () => {
    const db = createDatabase({ url: h.urls.app, ids });
    const plans: string[] = [];
    try {
      const actor = { companyId: companyA, userId };
      await listPermissionMemberships(explaining(db, plans), actor, { limit: 20 });
      await getMembershipPermissions(explaining(db, plans), actor, memberA, { limit: 20 }, false);
      expect(plans[0]).toMatch(/"Index Name":"memberships_(pkey|scope_\w+_idx)"/);
      expect(plans[0]).not.toContain('Seq Scan');
      expect(plans[1]).toMatch(/"Index Name":"permission_overrides_(membership_idx|pkey)"/);
      expect(plans[1]).toContain('memberships_pkey');
      expect(plans[1]).not.toContain('Seq Scan');
    } finally {
      await db.close();
    }
  });
});
