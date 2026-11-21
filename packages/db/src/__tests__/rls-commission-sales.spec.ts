import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createDatabase, type Database } from '../index.ts';
import {
  COMMISSION_TENANT,
  seedCommissionStatementTenants,
  expectPgError,
} from '../../test/commission-statement-fixtures.ts';
import { insertCommissionSale, saleIds as ids } from '../../test/commission-sales-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';

let testDb: TestDatabase;
let db: Database;
const { A, B } = COMMISSION_TENANT;
beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedCommissionStatementTenants(testDb.ownerUrl);
  db = createDatabase({ url: testDb.appUrl, ids });
});
afterAll(async () => {
  await db?.close();
  await testDb?.drop();
});
const asA = (query: ReturnType<typeof sql>) => db.withTenant(A.company, (tx) => tx.execute(query));
const asB = (query: ReturnType<typeof sql>) => db.withTenant(B.company, (tx) => tx.execute(query));

it('isolates commission_sales reads and writes across tenants (CM-R05)', async () => {
  const id = ids.newId();
  const sale = ids.newId();
  await db.withTenant(A.company, (tx) => insertCommissionSale(tx, A, { id, sale }));
  expect(
    await asA(sql`SELECT id FROM commission_sales WHERE sale_id=${sale}`),
  ).toEqual([{ id }]);
  expect(await asB(sql`SELECT id FROM commission_sales WHERE sale_id=${sale}`)).toEqual([]);
  await expectPgError(
    db.withTenant(B.company, (tx) => insertCommissionSale(tx, A, { sale })),
    '42501',
  );
  expect(
    await asB(sql`UPDATE commission_sales SET revision=99 WHERE sale_id=${sale} RETURNING id`),
  ).toEqual([]);
  await expectPgError(
    asA(sql`UPDATE commission_sales SET company_id=${B.company} WHERE sale_id=${sale}`),
    '42501',
  );
  expect(await asA(sql`SELECT revision FROM commission_sales WHERE sale_id=${sale}`)).toEqual([
    { revision: 1 },
  ]);
  await expectPgError(asA(sql`DELETE FROM commission_sales WHERE sale_id=${sale}`), '42501');
  await expectPgError(asA(sql`TRUNCATE commission_sales`), '42501');
  expect(await asA(sql`SELECT id FROM commission_sales WHERE sale_id=${sale}`)).toEqual([{ id }]);
});

it('allows the same sale id in two companies while each tenant sees only its own row', async () => {
  const sale = ids.newId();
  for (const tenant of [A, B])
    await db.withTenant(tenant.company, (tx) => insertCommissionSale(tx, tenant, { sale }));
  expect(await asA(sql`SELECT count(*)::int AS n FROM commission_sales WHERE sale_id=${sale}`)).toEqual([
    { n: 1 },
  ]);
  expect(await asB(sql`SELECT count(*)::int AS n FROM commission_sales WHERE sale_id=${sale}`)).toEqual([
    { n: 1 },
  ]);
});

it('rejects a cross-tenant foreign key through business, branch and seller', async () => {
  await expectPgError(
    db.withTenant(A.company, (tx) => insertCommissionSale(tx, A, { business: B.business })),
    '23503',
  );
  await expectPgError(
    db.withTenant(A.company, (tx) => insertCommissionSale(tx, A, { branch: B.branch })),
    '23503',
  );
  await expectPgError(
    db.withTenant(A.company, (tx) => insertCommissionSale(tx, A, { employee: B.employee })),
    '23503',
  );
});

it('leaves nothing outside withTenant or after a rolled-back transaction', async () => {
  await expect(
    db.withTenant(A.company, async (tx) => {
      await insertCommissionSale(tx, A);
      throw new Error('test rollback');
    }),
  ).rejects.toThrow('test rollback');
  const app = postgres(testDb.appUrl, { max: 1 });
  try {
    expect(await app`SELECT id FROM commission_sales`).toEqual([]);
  } finally {
    await app.end();
  }
});

it.each(['authUrl', 'dispatcherUrl', 'notificationsUrl'] as const)(
  '%s cannot read commission_sales',
  async (url) => {
    const role = postgres(testDb[url], { max: 1 });
    try {
      await expect(role`SELECT id FROM commission_sales`).rejects.toThrow(/permission denied/);
    } finally {
      await role.end();
    }
  },
);
