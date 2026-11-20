import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createDatabase, type Database } from '../index.ts';
import {
  COMMISSION_TENANT,
  expectPgError,
  seedCommissionStatementTenants,
} from '../../test/commission-statement-fixtures.ts';
import {
  insertCommissionBlockedCorrection,
  lockTargetStatement,
} from '../../test/commission-correction-fixtures.ts';
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

it('the blocked corrections table carries forced row-level security and the policies the app needs', async () => {
  const tables = await owner<
    { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]
  >`
    SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
    WHERE relname = 'commission_blocked_corrections'`;
  expect(tables.map((row) => [row.relname, row.relrowsecurity, row.relforcerowsecurity])).toEqual([
    ['commission_blocked_corrections', true, true],
  ]);
  const policies = await owner<{ cmd: string }[]>`
    SELECT cmd FROM pg_policies
    WHERE tablename = 'commission_blocked_corrections' ORDER BY cmd`;
  expect(policies.map((row) => row.cmd)).toEqual(['INSERT', 'SELECT', 'UPDATE']);
});

it('CM-R07: company B reads and writes none of the blocked corrections of company A', async () => {
  const statementId = await lockTargetStatement({
    db,
    companyId: A.company,
    businessId: A.business,
    period: '2026-11',
    ids,
  });
  let blockId = '';
  await db.withTenant(A.company, async (tx) => {
    blockId = await insertCommissionBlockedCorrection(tx, A, ids, statementId);
  });
  expect(await asA(sql`SELECT id FROM commission_blocked_corrections`)).toHaveLength(1);
  expect(await asB(sql`SELECT id FROM commission_blocked_corrections`)).toEqual([]);
  // صف على شركة تانية: سياسة الإدراج بترفض قبل ما أي مفتاح أجنبي يتكلم.
  await expectPgError(
    db.withTenant(B.company, (tx) =>
      insertCommissionBlockedCorrection(tx, A, ids, statementId, {
        employeeId: A.employee,
      }),
    ),
    '42501',
  );
  await expectPgError(
    db.withTenant(B.company, (tx) =>
      insertCommissionBlockedCorrection(tx, A, ids, statementId, {
        targetStatementId: statementId,
      }),
    ),
    '42501',
  );
  // تحديث صف شركة تانية: سياسة التحديث ما بتخليش صف واحد يتغيّر.
  expect(
    await asB(
      sql`UPDATE commission_blocked_corrections SET code='NO_SALARY'
        WHERE id=${blockId} RETURNING id`,
    ),
  ).toEqual([]);
  expect(
    await asA(sql`SELECT code FROM commission_blocked_corrections WHERE id=${blockId}`),
  ).toEqual([{ code: 'NO_PLAN' }]);
});

it('CM-R07: a session with no tenant set reads zero rows and cannot insert', async () => {
  const bare = postgres(testDb.appUrl, { max: 1, onnotice: () => undefined });
  try {
    expect(await bare`SELECT id FROM commission_blocked_corrections`).toEqual([]);
    await expectPgError(
      bare`INSERT INTO commission_blocked_corrections(
        company_id,id,business_id,employee_id,source_period,code,first_event_id,target_period,target_statement_id)
        VALUES (${A.company}, ${ids.newId()}, ${A.business}, ${A.employee}, '2026-10', 'NO_PLAN',
          ${ids.newId()}, '2026-11', ${ids.newId()})`,
      '42501',
    );
  } finally {
    await bare.end();
  }
});
