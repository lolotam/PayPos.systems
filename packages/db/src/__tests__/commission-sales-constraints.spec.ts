import { sql } from 'drizzle-orm';
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
const { A } = COMMISSION_TENANT;
beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedCommissionStatementTenants(testDb.ownerUrl);
  db = createDatabase({ url: testDb.appUrl, ids });
});
afterAll(async () => {
  await db?.close();
  await testDb?.drop();
});

it.each(['0.000', '30.000', '99999999999.999'])(
  'round trips exact sale money %s with a zero refund',
  async (pricePaid) => {
    const sale = ids.newId();
    await db.withTenant(A.company, async (tx) => {
      await insertCommissionSale(tx, A, { sale, pricePaid });
      const rows = await tx.execute<{ price_paid: string; refunded_amount: string }>(
        sql`SELECT price_paid, refunded_amount FROM commission_sales WHERE sale_id=${sale}`,
      );
      expect(rows).toEqual([{ price_paid: pricePaid, refunded_amount: '0.000' }]);
    });
  },
);

it.each(['-0.001', '100000000000.000', 'NaN'])('rejects invalid sale money %s', async (pricePaid) => {
  await expectPgError(
    db.withTenant(A.company, (tx) => insertCommissionSale(tx, A, { pricePaid })),
    pricePaid === '100000000000.000' ? '22003' : '23514',
  );
});

it.each(['0.000', '15.000', '30.000'])('accepts a refund of %s up to the price', async (refunded) => {
  const sale = ids.newId();
  await db.withTenant(A.company, (tx) => insertCommissionSale(tx, A, { sale, refundedAmount: refunded }));
  const [row] = await db.withTenant(A.company, (tx) =>
    tx.execute<{ refunded_amount: string }>(sql`SELECT refunded_amount FROM commission_sales WHERE sale_id=${sale}`),
  );
  expect(row).toEqual({ refunded_amount: refunded });
});

it.each(['30.001', '99999999999.999'])('rejects a refund above the price: %s', async (refunded) => {
  await expectPgError(
    db.withTenant(A.company, (tx) => insertCommissionSale(tx, A, { refundedAmount: refunded })),
    '23514',
  );
});

it.each([
  { revision: 0 },
  { revision: -1 },
])('rejects a non-positive revision %s', async ({ revision }) => {
  await expectPgError(
    db.withTenant(A.company, (tx) => insertCommissionSale(tx, A, { revision })),
    '23514',
  );
});

it.each(['2026-13', '2026-00', '26-11', '2026-1'])('rejects the malformed period %s', async (period) => {
  await expectPgError(
    db.withTenant(A.company, (tx) => insertCommissionSale(tx, A, { period })),
    '23514',
  );
});

it('rejects a period that disagrees with the business date', async () => {
  await expectPgError(
    db.withTenant(A.company, (tx) => insertCommissionSale(tx, A, { period: '2026-10' })),
    '23514',
  );
});

it.each(['REFUNDED', 'sold', ''])('rejects the status %s outside the stored values', async (status) => {
  await expectPgError(
    db.withTenant(A.company, (tx) => insertCommissionSale(tx, A, { status })),
    '23514',
  );
});

it('rejects a duplicate sale id inside one company', async () => {
  const sale = ids.newId();
  await db.withTenant(A.company, (tx) => insertCommissionSale(tx, A, { sale }));
  await expectPgError(
    db.withTenant(A.company, (tx) => insertCommissionSale(tx, A, { sale })),
    '23505',
  );
});

it('accepts a sale with no seller because the column is nullable as spec 059 lists it', async () => {
  const sale = ids.newId();
  await db.withTenant(A.company, async (tx) => {
    await tx.execute(sql`
      INSERT INTO commission_sales(company_id,id,business_id,sale_id,branch_id,seller_employee_id,
        business_date,period,price_paid,refunded_amount,status,revision)
      VALUES(${A.company},${ids.newId()},${A.business},${sale},${A.branch},NULL,
        '2026-11-01','2026-11','30.000','0.000','SOLD',1)`);
    const rows = await tx.execute<{ seller_employee_id: string | null }>(
      sql`SELECT seller_employee_id FROM commission_sales WHERE sale_id=${sale}`,
    );
    expect(rows).toEqual([{ seller_employee_id: null }]);
  });
});

it('denies pospay_app the identity columns on update and any delete', async () => {
  const sale = ids.newId();
  await db.withTenant(A.company, (tx) => insertCommissionSale(tx, A, { sale }));
  await expectPgError(
    db.withTenant(A.company, (tx) =>
      tx.execute(sql`UPDATE commission_sales SET sale_id=${ids.newId()} WHERE sale_id=${sale}`),
    ),
    '42501',
  );
  await expectPgError(
    db.withTenant(A.company, (tx) =>
      tx.execute(sql`UPDATE commission_sales SET id=${ids.newId()} WHERE sale_id=${sale}`),
    ),
    '42501',
  );
  await expectPgError(
    db.withTenant(A.company, (tx) =>
      tx.execute(sql`UPDATE commission_sales SET business_id=${ids.newId()} WHERE sale_id=${sale}`),
    ),
    '42501',
  );
});

it('allows the event-derived column update and rejects nothing else the grant covers', async () => {
  const sale = ids.newId();
  await db.withTenant(A.company, (tx) => insertCommissionSale(tx, A, { sale }));
  const updated = await db.withTenant(A.company, (tx) =>
    tx.execute<{ revision: number }>(
      sql`UPDATE commission_sales SET refunded_amount='10.000', revision=2 WHERE sale_id=${sale} RETURNING revision`,
    ),
  );
  expect(updated).toEqual([{ revision: 2 }]);
});
