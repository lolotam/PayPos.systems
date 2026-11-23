import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createDatabase, type Database } from '../index.ts';
import { insertCommissionCarry } from '../../test/commission-carry-fixtures.ts';
import { lockTargetStatement } from '../../test/commission-correction-fixtures.ts';
import {
  COMMISSION_TENANT,
  expectPgError,
  seedCommissionStatementTenants,
} from '../../test/commission-statement-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';

type SQLQuery = ReturnType<typeof sql>;

let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;
const ids = systemUuidV7();
const { A, B } = COMMISSION_TENANT;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedCommissionStatementTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids });
});
afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

const asA = (query: SQLQuery) => db.withTenant(A.company, (tx) => tx.execute(query));
const asB = (query: SQLQuery) => db.withTenant(B.company, (tx) => tx.execute(query));

/** كشفا مصدر وهدف لشريحة: أكتوبر ثم نوفمبر. */
async function statementsOf(tenant: typeof A | typeof B) {
  const request = { db, companyId: tenant.company, businessId: tenant.business, ids };
  const source = await lockTargetStatement({ ...request, period: '2026-10' });
  const target = await lockTargetStatement({ ...request, period: '2026-11' });
  return { source, target };
}

it('the carries table carries forced row-level security and only the policies an insert-only ledger needs', async () => {
  const tables = await owner<
    { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]
  >`
    SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
    WHERE relname = 'commission_carries'`;
  expect(tables.map((row) => [row.relname, row.relrowsecurity, row.relforcerowsecurity])).toEqual([
    ['commission_carries', true, true],
  ]);
  const policies = await owner<{ cmd: string }[]>`
    SELECT cmd FROM pg_policies WHERE tablename = 'commission_carries' ORDER BY cmd`;
  expect(policies.map((row) => row.cmd)).toEqual(['INSERT', 'SELECT']);
});

it('CM-R11: company B reads none of the carries of company A and cannot insert one for A', async () => {
  const a = await statementsOf(A);
  const b = await statementsOf(B);
  await db.withTenant(A.company, (tx) =>
    insertCommissionCarry(tx, A, ids, { sourceStatementId: a.source, targetStatementId: a.target }),
  );
  expect(await asA(sql`SELECT id FROM commission_carries`)).toHaveLength(1);
  expect(await asB(sql`SELECT id FROM commission_carries`)).toEqual([]);
  // صف على شركة A من جلسة B: سياسة الإدراج بترفض قبل أي مفتاح أجنبي.
  await expectPgError(
    db.withTenant(B.company, (tx) =>
      insertCommissionCarry(tx, A, ids, {
        sourceStatementId: a.source,
        targetStatementId: a.target,
      }),
    ),
    '42501',
  );
  // صف B بكشفي A: الزوج (شركة B، نشاط B، الشهر، كشف A) مش موجود، فالمفتاح المركّب بيرفض.
  await expectPgError(
    db.withTenant(B.company, (tx) =>
      insertCommissionCarry(tx, B, ids, {
        sourceStatementId: a.source,
        targetStatementId: b.target,
      }),
    ),
    '23503',
    'commission_carries_source_statement_fk',
  );
  await expectPgError(
    db.withTenant(B.company, (tx) =>
      insertCommissionCarry(tx, B, ids, {
        sourceStatementId: b.source,
        targetStatementId: a.target,
      }),
    ),
    '23503',
    'commission_carries_target_statement_fk',
  );
  // صف B بموظفة A: الموظفة جزء من مفتاحها المركّب، فالإحالة لصف شركة تانية مستحيلة.
  await expectPgError(
    db.withTenant(B.company, (tx) =>
      insertCommissionCarry(tx, B, ids, {
        sourceStatementId: b.source,
        targetStatementId: b.target,
        employeeId: A.employee,
      }),
    ),
    '23503',
    'commission_carries_employee_fk',
  );
});

it('CM-R11: B can neither update nor delete a carry of A, and A cannot either (insert-only)', async () => {
  const [row] = await asA(sql`SELECT id FROM commission_carries LIMIT 1`);
  const id = String(row?.['id']);
  await expectPgError(
    asB(sql`UPDATE commission_carries SET amount = -1 WHERE id = ${id}`),
    '42501',
  );
  await expectPgError(asB(sql`DELETE FROM commission_carries WHERE id = ${id}`), '42501');
  await expectPgError(
    asA(sql`UPDATE commission_carries SET amount = -1 WHERE id = ${id}`),
    '42501',
  );
  await expectPgError(asA(sql`DELETE FROM commission_carries WHERE id = ${id}`), '42501');
  expect(
    await asA(sql`SELECT amount::text AS amount FROM commission_carries WHERE id = ${id}`),
  ).toEqual([{ amount: '-25.000' }]);
});

it('CM-R11: a session with no tenant set reads zero rows and cannot insert', async () => {
  const bare = postgres(testDb.appUrl, { max: 1, onnotice: () => undefined });
  try {
    expect(await bare`SELECT id FROM commission_carries`).toEqual([]);
    await expectPgError(
      bare`INSERT INTO commission_carries(
        company_id,id,business_id,employee_id,kind,amount,source_statement_id,source_period,
        target_period,target_statement_id)
        VALUES (${A.company}, ${ids.newId()}, ${A.business}, ${A.employee}, 'COMMISSION', -1,
          ${ids.newId()}, '2026-10', '2026-11', ${ids.newId()})`,
      '42501',
    );
  } finally {
    await bare.end();
  }
});
