import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createDatabase, type Database } from '../index.ts';
import {
  COMMISSION_TENANT,
  seedCommissionStatementTenants,
} from '../../test/commission-statement-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';

let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;
const { A } = COMMISSION_TENANT;

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

/**
 * يجمع خطة الاستعلام نصاً: الفحص يقرا إن الجدول الرئيسي اتقري بمؤشر
 * مش بصف كامل، فمفيش قراءة بتكبر مع حجم الشركة.
 */
async function explainText(statement: ReturnType<typeof sql>): Promise<string> {
  const rows = await db.withTenant(A.company, (tx) =>
    tx.execute<{ 'QUERY PLAN': string }>(sql`EXPLAIN (FORMAT TEXT) ${statement}`),
  );
  return rows.map((row) => row['QUERY PLAN']).join('\n');
}

function expectIndexRead(plan: string, table: string): void {
  expect(plan).toMatch(/Index (Only )?Scan/);
  expect(plan).not.toContain(`Seq Scan on ${table}`);
}

it('reads the branch attachments through an index', async () => {
  const plan = await explainText(sql`SELECT branch_id, "from", "to" FROM employee_branches
    WHERE company_id = app_company_id() AND business_id = ${A.business}::uuid
      AND employee_id = ANY(ARRAY[${A.employee}::uuid])`);

  expectIndexRead(plan, 'employee_branches');
});

it('reads the received corrections through an index', async () => {
  const plan = await explainText(sql`SELECT source_ref, amount FROM commission_corrections
    WHERE company_id = app_company_id() AND business_id = ${A.business}::uuid
      AND target_period = '2026-10'`);

  expectIndexRead(plan, 'commission_corrections');
});

it('reads the projected sales through an index', async () => {
  const plan = await explainText(sql`SELECT sale_id, price_paid FROM commission_sales
    WHERE company_id = app_company_id() AND business_id = ${A.business}::uuid
      AND seller_employee_id = ${A.employee}::uuid AND period = '2026-10'`);

  expectIndexRead(plan, 'commission_sales');
});

it('reads the projected lines through an index', async () => {
  const plan = await explainText(sql`SELECT line_id, net_share FROM commission_lines
    WHERE company_id = app_company_id() AND business_id = ${A.business}::uuid
      AND period = '2026-10'`);

  expectIndexRead(plan, 'commission_lines');
});
