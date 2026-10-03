import { membershipPermissions } from '@pospay/contracts';
import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '@pospay/db';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { readMembershipDiscountLimit } from '../index.ts';
import { getMembershipPermissions } from '../queries/membership-permissions.query.ts';
import { createDiscountLimitTransactions } from '../persistence/discount-limit-transactions.ts';
import { SetDiscountLimit } from '../use-cases/set-discount-limit/set-discount-limit.ts';
import {
  newMember,
  newHeldMember,
  permissionFixture,
  seedOverride,
  type PermissionFixture,
} from './permissions-screen.fixture.ts';

let f: PermissionFixture;
beforeAll(async () => {
  f = await permissionFixture();
  for (const member of [f.ownMember, f.managerMember]) {
    await seedOverride(f, member, { permission_code: 'manage:discounts:company' });
  }
  for (const permission_code of ['manage:memberships:company', 'read:memberships:company']) {
    await seedOverride(f, f.managerMember, { permission_code });
  }
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
const set = (
  member: string,
  limit_bps: number | null,
  cookie = f.cookie,
  reason = 'Synthetic decision',
) =>
  f.h.send('POST', `/v1/permissions/memberships/${member}/discount-limit`, {
    cookie,
    company: f.company,
    body: { limit_bps, reason },
  });
const read = (member: string) =>
  f.db.withTenant(f.company, (tx) => readMembershipDiscountLimit(tx, f.company, member));
const audits = (member: string) => f.h
  .owner`SELECT actor_user_id, before, after, action FROM audit_log
  WHERE company_id=${f.company} AND entity='membership_discount_limit' AND entity_id=${member}
  ORDER BY after->>'decided_at', id`;
async function endOverride(id: string) {
  await f.h
    .owner`UPDATE permission_overrides SET expires_at=now() WHERE company_id=${f.company} AND id=${id}`;
}

it('DL-01..03 saves, changes, clears and audits exact before/after, actor and reason', async () => {
  const member = await newMember(f);
  expect(await read(member)).toEqual({ status: 'NOT_SET' });
  for (const limit of [1234, 500, null])
    expect((await set(member, limit)).body).toEqual({ limit_bps: limit });
  const rows = await audits(member);
  expect(rows.map((r) => r['before'])).toEqual([
    { membership_id: member, limit_bps: null },
    { membership_id: member, limit_bps: 1234 },
    { membership_id: member, limit_bps: 500 },
  ]);
  expect(rows.map((r) => (r['after'] as { limit_bps: unknown }).limit_bps)).toEqual([
    1234,
    500,
    null,
  ]);
  expect(rows.every((r) => r['actor_user_id'] === f.userId)).toBe(true);
  expect(rows[2]?.['after']).toMatchObject({
    reason: 'Synthetic decision',
    permission_code: 'manage:discounts:company',
  });
  expect(await read(member)).toEqual({ status: 'NOT_SET' });
  expect((await set(member, 0)).status).toBe(200);
  expect(await read(member)).toEqual({ status: 'SET', limit_bps: 0 });
  const detail = await f.h.send('GET', `/v1/permissions/memberships/${member}`, {
    cookie: f.cookie,
    company: f.company,
  });
  expect(membershipPermissions.parse(detail.body).discount_limit).toEqual({ limit_bps: 0 });
  expect(await f.h.redis.get(`identity:grants:${f.company}:membership:${member}:version`)).toBe(
    '4',
  );
});

it('DL-04..05 refuses self, sibling self and all active owner holders, including employee siblings', async () => {
  for (const member of [f.ownMember, await newHeldMember(f, { userId: f.userId })]) {
    expect((await set(member, 500)).body['code']).toBe('PERMISSION_SELF_EDIT');
  }
  const owner = await newMember(f, 'owner');
  const [holder] = await f.h
    .owner`SELECT employee_id FROM memberships WHERE company_id=${f.company} AND id=${owner}`;
  const sibling = await newHeldMember(f, { employeeId: holder?.['employee_id'] as string });
  for (const member of [owner, sibling]) {
    for (const value of [null, 0, 10000]) {
      expect((await set(member, value)).body['code']).toBe('PERMISSION_OWNER_PROTECTED');
    }
    expect(await audits(member)).toHaveLength(0);
  }
});

it('DL-06 requires current management and effective discount authority', async () => {
  const member = await newMember(f);
  const deny = await seedOverride(f, f.managerMember, {
    permission_code: 'manage:discounts:company',
    effect: 'DENY',
  });
  expect((await set(member, 500, f.managerCookie)).body['code']).toBe('PERMISSION_NOT_HELD');
  await endOverride(deny);
  const ownDeny = await seedOverride(f, f.managerMember, {
    permission_code: 'manage:memberships:company',
    effect: 'DENY',
  });
  expect((await set(member, 500, f.managerCookie)).status).toBe(403);
  await endOverride(ownDeny);
  expect(await audits(member)).toHaveLength(0);
  expect((await set(member, 500, f.managerCookie)).status).toBe(200);
});

it('DL-07 hides cross-tenant and inactive memberships; existing FORCE RLS protects the new column', async () => {
  const foreign = await newMember(f, 'viewer', f.otherCompany);
  await f.h
    .owner`UPDATE memberships SET limit_bps=1234 WHERE company_id=${f.otherCompany} AND id=${foreign}`;
  expect(await read(foreign)).toEqual({ status: 'MEMBERSHIP_NOT_FOUND' });
  expect((await set(foreign, 500)).status).toBe(403);
  await f.db.withTenant(f.company, async (tx) => {
    expect(
      await tx.execute(sql`SELECT limit_bps FROM memberships WHERE id=${foreign}`),
    ).toHaveLength(0);
    expect(
      await tx.execute(sql`UPDATE memberships SET limit_bps=500 WHERE id=${foreign} RETURNING id`),
    ).toHaveLength(0);
    expect(
      await tx.execute(sql`DELETE FROM memberships WHERE id=${foreign} RETURNING id`),
    ).toHaveLength(0);
  });
  const inactive = await newMember(f);
  await f.h
    .owner`UPDATE memberships SET starts_at=now()-interval '2 days', ends_at=now()-interval '1 day'
    WHERE company_id=${f.company} AND id=${inactive}`;
  expect(await read(inactive)).toEqual({ status: 'MEMBERSHIP_NOT_FOUND' });
  expect((await set(inactive, 500)).status).toBe(403);
  const [flags] = await f.h
    .owner`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='memberships'`;
  expect(flags).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
});

it('DL-08 serializes changes, retaining a continuous audit chain and one current value', async () => {
  const member = await newMember(f);
  const responses = await Promise.all([set(member, 500), set(member, 10000), set(member, null)]);
  expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
  const rows = await audits(member);
  expect(rows).toHaveLength(3);
  expect(rows[0]?.['before']).toMatchObject({ limit_bps: null });
  for (let i = 1; i < rows.length; i++) {
    expect(rows[i]?.['before']).toEqual({
      membership_id: member,
      limit_bps: (rows[i - 1]?.['after'] as { limit_bps: unknown }).limit_bps,
    });
  }
  const last = (rows[2]?.['after'] as { limit_bps: number | null }).limit_bps;
  expect(await read(member)).toEqual(
    last === null ? { status: 'NOT_SET' } : { status: 'SET', limit_bps: last },
  );
});

it('DL-10 rolls the value back when audit fails', async () => {
  const member = await newMember(f);
  const tx = createDiscountLimitTransactions(f.db, f.ids);
  const useCase = new SetDiscountLimit(
    {
      run: (company, user, work) =>
        tx.run(company, user, (scope) =>
          work({
            ...scope,
            audit: {
              record: async () => {
                throw new Error('Synthetic audit failure');
              },
            },
          }),
        ),
    },
    { invalidate: async () => undefined },
  );
  await expect(
    useCase.execute({ companyId: f.company, userId: f.userId }, member, {
      limit_bps: 500,
      reason: 'Synthetic',
    }),
  ).rejects.toThrow('Synthetic audit failure');
  expect(await read(member)).toEqual({ status: 'NOT_SET' });
  expect(await audits(member)).toHaveLength(0);
});

it('validates body bounds and reason over HTTP, without touching history', async () => {
  const member = await newMember(f);
  for (const value of [-1, 10001, 0.1]) expect((await set(member, value)).status).toBe(400);
  expect((await set(member, null, f.cookie, ' ')).status).toBe(400);
  expect((await set(member, 500, '')).status).toBe(401);
  expect(await audits(member)).toHaveLength(0);
});

it('uses the membership PK on the public read and returns the exact detail result shape', async () => {
  const member = await newMember(f);
  const plans: string[] = [];
  await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan = off`);
    const proxy = new Proxy(tx, {
      get: (target, property, receiver) =>
        property === 'execute'
          ? async (query: SQL) => {
              plans.push(
                JSON.stringify(await target.execute(sql`EXPLAIN (ANALYZE, FORMAT JSON) ${query}`)),
              );
              return target.execute(query);
            }
          : Reflect.get(target, property, receiver),
    });
    expect(await readMembershipDiscountLimit(proxy as Tx, f.company, member)).toEqual({
      status: 'NOT_SET',
    });
  });
  expect(plans.join('')).toContain('memberships_pkey');
  expect(plans.join('')).not.toContain('Seq Scan');
  const detail = await getMembershipPermissions(
    f.db,
    { companyId: f.company, userId: f.userId },
    member,
    { limit: 20 },
  );
  expect(detail?.discount_limit).toEqual({ limit_bps: null });
});
