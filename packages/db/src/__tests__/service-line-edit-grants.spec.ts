import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { systemUuidV7 } from '@pospay/ids';
import { createDatabase, type Database } from '../index.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { seedTwoTenants, TENANT, USER } from '../../test/tenancy-fixtures.ts';
import { seedOrders, ORDER_IDS } from '../../test/orders-fixture.ts';

let testDb: TestDatabase, db: Database, owner: postgres.Sql;
const { A, B } = TENANT;
const line = ORDER_IDS.line;
type SqlQuery = ReturnType<typeof sql>;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await seedOrders(owner);
  db = createDatabase({ url: testDb.appUrl, ids: systemUuidV7() });
});
afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

const asA = (query: SqlQuery) =>
  db.withTenant(A.company, (tx) => tx.execute(query), { userId: USER });

async function denied(query: SqlQuery) {
  const error = await asA(query).then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(Error);
  const cause = (error as Error & { cause?: { code?: string } }).cause;
  expect(cause?.code).toBe('42501');
}

it('updates price, the limit trio and revision on the tenant line', async () => {
  expect(
    await asA(sql`UPDATE service_lines SET price=2.000, discount=0.500, net=1.500
      WHERE id=${line} RETURNING price::text AS price, discount::text AS discount, net::text AS net`),
  ).toEqual([{ price: '2.000', discount: '0.500', net: '1.500' }]);
  expect(
    await asA(sql`UPDATE service_lines SET effective_discount_bps=2500, limit_bps_applied=5000, limit_source='PERSON'
      WHERE id=${line} RETURNING effective_discount_bps, limit_bps_applied, limit_source`),
  ).toEqual([{ effective_discount_bps: 2500, limit_bps_applied: 5000, limit_source: 'PERSON' }]);
  const [before] = await asA(sql`SELECT revision FROM service_lines WHERE id=${line}`);
  const [after] = await asA(sql`UPDATE service_lines SET revision=revision+1 WHERE id=${line} RETURNING revision`);
  expect(after?.['revision']).toBe(Number(before?.['revision']) + 1);
});

const forbidden: SqlQuery[] = [
  sql`UPDATE service_lines SET list_price=2.000 WHERE id=${line}`,
  sql`UPDATE service_lines SET recorded_by=${USER} WHERE id=${line}`,
  sql`UPDATE service_lines SET recorded_by_membership_id=${ORDER_IDS.membership} WHERE id=${line}`,
  sql`UPDATE service_lines SET session_id=${ORDER_IDS.session} WHERE id=${line}`,
  sql`UPDATE service_lines SET service_id=${ORDER_IDS.service} WHERE id=${line}`,
  sql`UPDATE service_lines SET ordinal=1 WHERE id=${line}`,
  sql`UPDATE service_lines SET late=false WHERE id=${line}`,
  sql`UPDATE service_lines SET name_en='Synthetic service' WHERE id=${line}`,
];

it('refuses updates outside the column grant and refuses delete', async () => {
  for (const query of forbidden) await denied(query);
  await denied(sql`DELETE FROM service_lines WHERE id=${line}`);
});

it('a cross-tenant update of an allowed column affects no row', async () => {
  const [before] = await asA(sql`SELECT revision FROM service_lines WHERE id=${line}`);
  const updated = await db.withTenant(
    B.company,
    (tx) =>
      tx.execute(
        sql`UPDATE service_lines SET revision=revision+1 WHERE company_id=${A.company} AND id=${line} RETURNING id`,
      ),
    { userId: USER },
  );
  expect(updated).toEqual([]);
  const [after] = await asA(sql`SELECT revision FROM service_lines WHERE id=${line}`);
  expect(after).toEqual(before);
});

it('still rejects a net that is not price minus discount', async () => {
  const error = await asA(
    sql`UPDATE service_lines SET price=2.000, discount=0.000, net=1.000 WHERE id=${line}`,
  ).then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(Error);
  const cause = (error as Error & { cause?: { code?: string; constraint_name?: string } }).cause;
  expect(cause?.code).toBe('23514');
  expect(cause?.constraint_name).toBe('service_lines_amounts');
});

it('grants a same-status update and refuses an unjustified cancellation', async () => {
  expect(
    await asA(sql`UPDATE service_lines SET status='ACTIVE' WHERE id=${line} RETURNING status`),
  ).toEqual([{ status: 'ACTIVE' }]);
  const error = await asA(sql`UPDATE service_lines SET status='CANCELLED' WHERE id=${line}`).then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(Error);
  const cause = (error as Error & { cause?: { code?: string; constraint_name?: string } }).cause;
  expect(cause?.code).toBe('23514');
  expect(cause?.constraint_name).toBe('service_lines_cancel_guard');
});
