import { systemUuidV7 } from '@pospay/ids';
import { sql, type SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createDatabase, type Database } from '../index.ts';
import { createTenantWrappers } from '../with-tenant.ts';
import {
  claimRequest,
  consumeAndRate,
  expectPgError,
  insertRequest,
  OTHER_RATING_BUSINESS,
  RATING_TENANT,
  seedRatingTenants,
} from '../../test/rating-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';

let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;
const ids = systemUuidV7();
const { A, B } = RATING_TENANT;
const NOW = '2026-06-02T00:00:00Z';
const TABLES = ['rating_requests', 'rating_performers', 'ratings', 'rating_attributions'] as const;
let requestId = '';
let ratingId = '';

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedRatingTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids, maxConnections: 2 });
  const tokenHash = Buffer.alloc(32, 221);
  ratingId = (await db.withTenant(A.company, async (tx) => {
    requestId = await insertRequest(tx, { tenant: A, date: '2026-12-01' });
    await claimRequest(tx, {
      tenant: A,
      requestId,
      tokenHash,
      readyEventId: ids.newId(),
      now: NOW,
      performers: [A.employees[0]],
    });
    return consumeAndRate(tx, {
      tenant: A,
      requestId,
      tokenHash,
      now: NOW,
      stars: 5,
      attribute: [A.employees[0]],
    });
  })) as string;
  await owner`ALTER TABLE rating_performers DISABLE TRIGGER rating_performers_insert_guard`;
  await owner`ALTER TABLE ratings DISABLE TRIGGER ratings_insert_guard`;
  await owner`ALTER TABLE rating_attributions DISABLE TRIGGER rating_attributions_insert_guard`;
});

afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

const asA = (query: SQL) => db.withTenant(A.company, (tx) => tx.execute(query));
const asB = (query: SQL) => db.withTenant(B.company, (tx) => tx.execute(query));

it('all four tables force RLS and expose exactly their required policies', async () => {
  const tables = await owner<
    { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]
  >`
    SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class
    WHERE relname=ANY(${[...TABLES]}) ORDER BY relname`;
  expect(tables.map((row) => [row.relname, row.relrowsecurity, row.relforcerowsecurity])).toEqual([
    ['rating_attributions', true, true],
    ['rating_performers', true, true],
    ['rating_requests', true, true],
    ['ratings', true, true],
  ]);
  const policies = await owner<{ tablename: string; cmd: string }[]>`
    SELECT tablename,cmd FROM pg_policies WHERE tablename=ANY(${[...TABLES]}) ORDER BY tablename,cmd`;
  expect(policies).toEqual([
    { tablename: 'rating_attributions', cmd: 'INSERT' },
    { tablename: 'rating_attributions', cmd: 'SELECT' },
    { tablename: 'rating_performers', cmd: 'INSERT' },
    { tablename: 'rating_performers', cmd: 'SELECT' },
    { tablename: 'rating_requests', cmd: 'INSERT' },
    { tablename: 'rating_requests', cmd: 'SELECT' },
    { tablename: 'rating_requests', cmd: 'UPDATE' },
    { tablename: 'ratings', cmd: 'INSERT' },
    { tablename: 'ratings', cmd: 'SELECT' },
  ]);
});

it.each(TABLES)(
  'tenant B reads zero rows of A in %s and lock privileges stay exact',
  async (table) => {
    const rows = sql`SELECT id FROM ${sql.identifier(table)}`;
    const lock = sql`SELECT id FROM ${sql.identifier(table)} FOR UPDATE`;
    expect(await asB(rows)).toEqual([]);
    if (table === 'rating_requests') {
      expect(await asB(lock)).toEqual([]);
      return;
    }
    await expectPgError(asA(lock), '42501');
    await expectPgError(asB(lock), '42501');
  },
);

it('tenant B cannot insert rows carrying tenant A company_id', async () => {
  await expectPgError(
    asB(sql`INSERT INTO rating_requests(company_id,id,business_id,customer_id,business_date,branch_id,due_at)
      VALUES(${A.company},${ids.newId()},${A.business},${A.customer},'2026-12-02',${A.branch},${NOW})`),
    '42501',
  );
  await expectPgError(
    asB(sql`INSERT INTO rating_performers(company_id,id,request_id,business_id,employee_id)
      VALUES(${A.company},${ids.newId()},${requestId},${A.business},${A.employees[0]})`),
    '42501',
  );
  await expectPgError(
    asB(sql`INSERT INTO ratings(company_id,id,request_id,business_id,branch_id,stars,submitted_at)
      VALUES(${A.company},${ids.newId()},${requestId},${A.business},${A.branch},5,${NOW})`),
    '42501',
  );
  await expectPgError(
    asB(sql`INSERT INTO rating_attributions(company_id,id,rating_id,request_id,employee_id,business_id,branch_id,stars,submitted_at)
      VALUES(${A.company},${ids.newId()},${ratingId},${requestId},${A.employees[0]},${A.business},${A.branch},5,${NOW})`),
    '42501',
  );
});

it('rating_requests cannot be re-homed and cross-tenant updates affect no rows', async () => {
  await expectPgError(
    asA(
      sql`UPDATE rating_requests SET business_id=${OTHER_RATING_BUSINESS.business} WHERE id=${requestId}`,
    ),
    '42501',
  );
  await expectPgError(
    asA(sql`UPDATE rating_requests SET company_id=${B.company} WHERE id=${requestId}`),
    '42501',
  );
  const scheduled =
    await asA(sql`INSERT INTO rating_requests(company_id,id,business_id,customer_id,business_date,branch_id,due_at)
    VALUES(${A.company},${ids.newId()},${A.business},${A.customer},'2026-12-03',${A.branch},${NOW}) RETURNING id`);
  await expectPgError(
    asA(
      sql`UPDATE rating_requests SET branch_id=${OTHER_RATING_BUSINESS.branch} WHERE id=${scheduled[0]?.['id']}`,
    ),
    '23503',
    'rating_requests_branch_fk',
  );
  expect(
    await asB(sql`UPDATE rating_requests SET due_at=now() WHERE id=${requestId} RETURNING id`),
  ).toEqual([]);
});

it.each(TABLES)('the app cannot update, delete or truncate %s', async (table) => {
  if (table !== 'rating_requests') {
    const change = table === 'ratings' ? sql`stars=4` : sql`employee_id=${A.employees[1]}`;
    await expectPgError(asA(sql`UPDATE ${sql.identifier(table)} SET ${change}`), '42501');
  }
  await expectPgError(asA(sql`DELETE FROM ${sql.identifier(table)}`), '42501');
  await expectPgError(asA(sql`TRUNCATE ${sql.identifier(table)}`), '42501');
});

it('a pooled A-to-B sequence and a transaction without a tenant never leak rows', async () => {
  const client = postgres(testDb.appUrl, { max: 1, onnotice: () => undefined });
  const wrappers = createTenantWrappers(drizzle(client), ids);
  try {
    await wrappers.withTenant(A.company, (tx) =>
      insertRequest(tx, { tenant: A, date: '2026-12-04' }),
    );
    for (const table of TABLES) {
      expect(
        await wrappers.withTenant(B.company, (tx) =>
          tx.execute(sql`SELECT id FROM ${sql.identifier(table)}`),
        ),
      ).toEqual([]);
      expect(await client`SELECT id FROM ${client(table)}`).toEqual([]);
    }
  } finally {
    await client.end();
  }
});

it('dispatcher and auth roles have no privilege on any rating table', async () => {
  const rows = await owner<{ role: string; table: string }[]>`
    SELECT role,table_name AS table FROM unnest(ARRAY['pospay_dispatcher','pospay_auth']) AS role
    CROSS JOIN unnest(${[...TABLES]}::text[]) AS table_name
    WHERE has_table_privilege(role,table_name,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')`;
  expect(rows).toEqual([]);
});
