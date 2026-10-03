import { businessSettings, discountLimit } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  newMember,
  newHeldMember,
  permissionFixture,
  seedOverride,
  type PermissionFixture,
} from '../../../../test/permissions-fixture.ts';
import { readEffectiveDiscountLimit } from '../index.ts';
import { readBusinessDiscountDefault } from '../queries/business-discount-default.query.ts';
import { createSettingsTransactions } from '../persistence/settings-transactions.ts';
import { SetBusinessDiscountDefault } from '../use-cases/set-business-discount-default/set-business-discount-default.ts';

let f: PermissionFixture;
beforeAll(async () => {
  f = await permissionFixture();
  for (const member of [f.ownMember, f.managerMember]) {
    for (const permission_code of [
      'manage:settings:business',
      'read:settings:business',
      'manage:discounts:company',
    ])
      await seedOverride(f, member, { permission_code });
  }
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
const set = (
  limit_bps: number | null,
  business = f.business,
  cookie = f.managerCookie,
  company = f.company,
) =>
  f.h.send('POST', `/v1/businesses/${business}/settings/discount-limit`, {
    cookie,
    company,
    body: { limit_bps, reason: ' Synthetic decision ' },
  });
const read = async (business = f.business) => {
  const response = await f.h.send('GET', `/v1/businesses/${business}/settings`, {
    cookie: f.cookie,
    company: f.company,
  });
  expect(response.status).toBe(200);
  return businessSettings.parse(response.body);
};
const effective = (member: string, business = f.business) =>
  f.db.withTenant(f.company, (tx) => readEffectiveDiscountLimit(tx, f.company, business, member));
const audits = (business = f.business) => f.h
  .owner`SELECT actor_user_id, before, after, action FROM audit_log
  WHERE company_id=${f.company} AND entity='business_discount_limit' AND entity_id=${business} ORDER BY id`;
async function expire(id: string) {
  await f.h
    .owner`UPDATE permission_overrides SET expires_at=now() WHERE company_id=${f.company} AND id=${id}`;
}

it('BD-01..02 saves, changes, clears, validates zero/full bounds and audits exact decision', async () => {
  expect((await read()).limit_bps).toBeNull();
  for (const limit of [1234, 500, null, 0, 10000]) {
    const response = await set(limit);
    expect(response.status).toBe(200);
    expect(discountLimit.parse(response.body)).toEqual({ limit_bps: limit });
    expect((await read()).limit_bps).toBe(limit);
  }
  const rows = await audits();
  expect(rows.map((row) => row['before'])).toEqual(
    [null, 1234, 500, null, 0].map((limit_bps) => ({ business_id: f.business, limit_bps })),
  );
  expect(rows.map((row) => (row['after'] as { limit_bps: number | null }).limit_bps)).toEqual([
    1234,
    500,
    null,
    0,
    10000,
  ]);
  expect(rows.every((row) => row['actor_user_id'] === f.managerId)).toBe(true);
  expect(rows[2]).toMatchObject({
    action: 'business_discount_limit.cleared',
    after: {
      reason: 'Synthetic decision',
      permission_code: 'manage:discounts:company',
      decided_at: expect.any(String),
    },
  });
  expect((await read()).overridden).toContain('limit_bps');
});

it('BD-03 refuses missing, expired, denied and out-of-scope discount authority without writes', async () => {
  const before = await audits();
  const base = await read();
  for (const scope of [
    { effect: 'DENY' as const, scope_type: 'BUSINESS' as const, scope_id: f.business },
    { effect: 'DENY' as const, scope_type: 'BRANCH' as const, scope_id: f.branch },
  ]) {
    const id = await seedOverride(f, f.managerMember, {
      permission_code: 'manage:discounts:company',
      ...scope,
    });
    expect((await set(500)).body['code']).toBe('PERMISSION_NOT_HELD');
    await expire(id);
  }
  const managementDeny = await seedOverride(f, f.managerMember, {
    permission_code: 'manage:settings:business',
    effect: 'DENY',
  });
  expect((await set(500)).status).toBe(403);
  await expire(managementDeny);
  await f.h.owner`UPDATE permission_overrides SET expires_at=now() WHERE company_id=${f.company}
    AND membership_id=${f.managerMember} AND permission_code='manage:discounts:company'`;
  expect((await set(500)).body['code']).toBe('PERMISSION_NOT_HELD');
  const other = await seedOverride(f, f.managerMember, {
    permission_code: 'manage:discounts:company',
    scope_type: 'BUSINESS',
    scope_id: f.otherBusiness,
  });
  expect((await set(500)).body['code']).toBe('PERMISSION_SCOPE_OUTSIDE_REACH');
  await expire(other);
  expect(await read()).toEqual(base);
  expect(await audits()).toEqual(before);
  await seedOverride(f, f.managerMember, {
    permission_code: 'manage:discounts:company',
    scope_type: 'BUSINESS',
    scope_id: f.business,
  });
  expect((await set(500)).status).toBe(200);
});

it('BD-04/09 isolates businesses and tenants, preserves settings and prevents generic PATCH bypass', async () => {
  expect((await set(1234, f.otherBusiness, f.cookie)).status).toBe(200);
  expect((await read(f.otherBusiness)).limit_bps).toBe(1234);
  expect((await read()).limit_bps).toBe(500);
  expect((await set(0, f.business, f.cookie, f.otherCompany)).status).toBe(403);
  expect(
    (
      await f.h.send('GET', `/v1/businesses/${f.business}/settings`, {
        cookie: f.cookie,
        company: f.otherCompany,
      })
    ).status,
  ).toBe(403);
  const settingsUrl = `/v1/businesses/${f.business}/settings`;
  expect(
    (
      await f.h.app.inject({
        method: 'PATCH',
        url: settingsUrl,
        headers: { cookie: f.cookie, 'x-company-id': f.company },
        payload: { default_language: 'en', calendar: 'hijri' },
      })
    ).statusCode,
  ).toBe(200);
  expect((await set(null)).status).toBe(200);
  expect(await read()).toMatchObject({
    default_language: 'en',
    calendar: 'hijri',
    limit_bps: null,
    overridden: ['default_language', 'calendar'],
  });
  expect(
    (
      await f.h.app.inject({
        method: 'PATCH',
        url: settingsUrl,
        headers: { cookie: f.cookie, 'x-company-id': f.company },
        payload: { limit_bps: 500 },
      })
    ).statusCode,
  ).toBe(400);
});

it('BD-06..08 resolves owner/person/business/unconfigured and rejects unavailable memberships', async () => {
  const member = await newMember(f);
  expect(await effective(member)).toEqual({ status: 'NOT_CONFIGURED' });
  await set(1234);
  expect(await effective(member)).toEqual({ status: 'SET', source: 'BUSINESS', limit_bps: 1234 });
  await f.h
    .owner`UPDATE memberships SET limit_bps=0 WHERE company_id=${f.company} AND id=${member}`;
  expect(await effective(member)).toEqual({ status: 'SET', source: 'PERSON', limit_bps: 0 });
  const owner = await newMember(f, 'owner');
  const [holder] = await f.h
    .owner`SELECT employee_id FROM memberships WHERE company_id=${f.company} AND id=${owner}`;
  const sibling = await newHeldMember(f, { employeeId: holder?.['employee_id'] as string });
  for (const id of [f.ownMember, owner, sibling])
    expect(await effective(id)).toEqual({ status: 'UNLIMITED', source: 'OWNER' });
  await f.h
    .owner`UPDATE memberships SET starts_at=now()+interval '1 day' WHERE company_id=${f.company} AND id=${owner}`;
  expect(await effective(sibling)).toEqual({ status: 'SET', source: 'BUSINESS', limit_bps: 1234 });
  expect(await effective(owner)).toEqual({ status: 'MEMBERSHIP_NOT_FOUND' });
  const foreign = await newMember(f, 'viewer', f.otherCompany);
  expect(await effective(foreign)).toEqual({ status: 'MEMBERSHIP_NOT_FOUND' });
  expect(await effective(member, '01920000-0000-7000-8000-000000000fff')).toEqual({
    status: 'MEMBERSHIP_NOT_FOUND',
  });
  await f.h.owner`UPDATE memberships SET scope_type='BUSINESS', scope_id=${f.otherBusiness}
    WHERE company_id=${f.company} AND id=${member}`;
  expect(await effective(member)).toEqual({ status: 'MEMBERSHIP_NOT_FOUND' });
  await f.h.owner`UPDATE memberships SET scope_type='BRANCH', scope_id=${f.branch}
    WHERE company_id=${f.company} AND id=${member}`;
  expect(await effective(member)).toEqual({ status: 'SET', source: 'PERSON', limit_bps: 0 });
  expect(await effective(member, f.otherBusiness)).toEqual({ status: 'MEMBERSHIP_NOT_FOUND' });
  await f.h
    .owner`UPDATE memberships SET starts_at=now()-interval '2 days', ends_at=now()-interval '1 day'
    WHERE company_id=${f.company} AND id=${member}`;
  expect(await effective(member)).toEqual({ status: 'MEMBERSHIP_NOT_FOUND' });
});

it('BD-05 serializes concurrent edits and rolls back when audit fails', async () => {
  const before = (await read()).limit_bps;
  const count = (await audits()).length;
  const responses = await Promise.all([set(700), set(800)]);
  expect(responses.map((r) => r.status)).toEqual([200, 200]);
  const rows = (await audits()).slice(count);
  expect(rows).toHaveLength(2);
  expect(rows[0]?.['before']).toEqual({ business_id: f.business, limit_bps: before });
  const first = (rows[0]?.['after'] as { limit_bps: number }).limit_bps;
  expect(rows[1]?.['before']).toEqual({ business_id: f.business, limit_bps: first });
  const saved = await read();
  const transactions = createSettingsTransactions(f.db, f.ids);
  const useCase = new SetBusinessDiscountDefault(
    {
      run: (companyId, userId, work) =>
        transactions.run(companyId, userId, (scope) =>
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
    useCase.execute({ companyId: f.company, userId: f.managerId }, f.business, {
      limit_bps: 900,
      reason: 'Synthetic',
    }),
  ).rejects.toThrow('Synthetic audit failure');
  expect(await read()).toEqual(saved);
  expect((await audits()).length).toBe(count + 2);
});

it('BD-02 validates HTTP input and existing RLS protects the new column', async () => {
  const count = (await audits()).length;
  for (const limit of [-1, 10001, 0.1]) expect((await set(limit)).status).toBe(400);
  for (const reason of [' ', 'x'.repeat(501)])
    expect(
      (
        await f.h.send('POST', `/v1/businesses/${f.business}/settings/discount-limit`, {
          cookie: f.cookie,
          company: f.company,
          body: { limit_bps: null, reason },
        })
      ).status,
    ).toBe(400);
  expect((await set(0, f.business, '')).status).toBe(401);
  expect((await audits()).length).toBe(count);
  await f.db.withTenant(f.otherCompany, async (tx) => {
    expect(
      await tx.execute(
        sql`SELECT limit_bps FROM business_settings WHERE business_id=${f.business}`,
      ),
    ).toHaveLength(0);
    expect(
      await tx.execute(
        sql`UPDATE business_settings SET limit_bps=0 WHERE business_id=${f.business} RETURNING business_id`,
      ),
    ).toHaveLength(0);
  });
  await expect(
    f.db.withTenant(f.otherCompany, (tx) =>
      tx.execute(sql`INSERT INTO business_settings (company_id,business_id,limit_bps)
    VALUES (${f.company},${f.business},0)`),
    ),
  ).rejects.toThrow();
});

it('uses PK indexes for default and scoped subject queries with exact result shapes', async () => {
  const plans: string[] = [];
  await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
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
    expect(await readBusinessDiscountDefault(proxy as Tx, f.company, f.business)).toBe(
      (await read()).limit_bps,
    );
    expect(
      await readEffectiveDiscountLimit(proxy as Tx, f.company, f.business, f.ownMember),
    ).toEqual({ status: 'UNLIMITED', source: 'OWNER' });
  });
  expect(plans.join('')).toContain('business_settings_pkey');
  expect(plans.join('')).toContain('memberships_pkey');
  expect(plans.join('')).toContain('businesses_pkey');
  expect(plans.join('')).toContain('branches_company_');
  expect(plans.join('')).not.toContain('Seq Scan');
});
