import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createDatabase, type Database } from '../index.ts';
import {
  COMMISSION_TENANT,
  seedCommissionStatementTenants,
  expectPgError,
} from '../../test/commission-statement-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';

let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;
const { A } = COMMISSION_TENANT;

const countStatements = (period: string) =>
  db.withTenant(A.company, (tx) =>
    tx.execute<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM commission_statements WHERE period=${period}`,
    ),
  );

const insertSale = (saleId: string) =>
  owner`INSERT INTO commission_sales(company_id,id,business_id,sale_id,branch_id,seller_employee_id,
      business_date,period,price_paid,refunded_amount,status,revision)
    VALUES (${A.company},gen_random_uuid(),${A.business}::uuid,${saleId}::uuid,${A.branch}::uuid,
      ${A.employee}::uuid,'2020-04-01'::date,'2020-04','1.000','0.000','SOLD',1)`;

const countSales = () =>
  db.withTenant(A.company, (tx) =>
    tx.execute<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM commission_sales WHERE period='2020-04'`,
    ),
  );

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedCommissionStatementTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids: { newId: () => crypto.randomUUID() } });
});

afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

it('refuses a write inside a read-only tenant transaction', async () => {
  await expectPgError(
    db.withTenant(
      A.company,
      async (tx) => {
        await tx.execute(sql`INSERT INTO commission_statements(company_id,id,business_id,period,status)
          VALUES (app_company_id(),gen_random_uuid(),${A.business}::uuid,'2019-01','DRAFT')`);
      },
      { readOnly: true },
    ),
    '25006',
  );
});

it('refuses a write inside a read-only tenant transaction with a deadline', async () => {
  await expectPgError(
    db.withTenant(
      A.company,
      async (tx) => {
        await tx.execute(sql`INSERT INTO commission_statements(company_id,id,business_id,period,status)
          VALUES (app_company_id(),gen_random_uuid(),${A.business}::uuid,'2019-03','DRAFT')`);
      },
      { readOnly: true, timeoutMs: 5000 },
    ),
    '25006',
  );
});

it('keeps one snapshot across a concurrent committed change', async () => {
  await insertSale('01930000-0000-7000-8000-000000000001');
  const counts = await db.withTenant(
    A.company,
    async (tx) => {
      const before = await tx.execute<{ count: number }>(
        sql`SELECT count(*)::int AS count FROM commission_sales WHERE period='2020-04'`,
      );
      // تغيير متزامن من معاملة تانية بعد ما اللقطة اتقرأت: معاملة القراءة
      // لازم تفضل على اللقطة القديمة مش على الصف اللي اتكتب بعد ما لقطة المعاملة اتقرأت.
      await insertSale('01930000-0000-7000-8000-000000000002');
      const after = await tx.execute<{ count: number }>(
        sql`SELECT count(*)::int AS count FROM commission_sales WHERE period='2020-04'`,
      );
      return { before: before[0]?.count, after: after[0]?.count };
    },
    { readOnly: true },
  );

  expect(counts.before).toBe(1);
  expect(counts.after).toBe(1);
});

it('sees the committed change from a later writer transaction', async () => {
  const seen = await countSales();
  expect(seen[0]?.count).toBe(2);
});

it('keeps the default tenant transaction writable', async () => {
  await db.withTenant(A.company, async (tx) => {
    await tx.execute(sql`INSERT INTO commission_statements(company_id,id,business_id,period,status)
      VALUES (app_company_id(),gen_random_uuid(),${A.business}::uuid,'2019-02','DRAFT')`);
  });
  const seen = await countStatements('2019-02');
  expect(seen[0]?.count).toBe(1);
});
