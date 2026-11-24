import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createDatabase, type Database, type IdGenerator, type Tx } from '../index.ts';
import { lockTargetStatement } from '../../test/commission-correction-fixtures.ts';
import {
  COMMISSION_TENANT,
  expectPgError,
  seedCommissionStatementTenants,
} from '../../test/commission-statement-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { USER } from '../../test/tenancy-fixtures.ts';

type SQLQuery = ReturnType<typeof sql>;

let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;
const ids: IdGenerator = systemUuidV7();
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

/** صف إرجاع واحد: السبب فيه، والإرجاع للإضافة فقط (FR-031). */
async function insertReturn(
  tx: Tx,
  tenant: typeof A | typeof B,
  statementId: string,
  reason = 'خطة سوسن غلط',
): Promise<string> {
  const id = ids.newId();
  await tx.execute(sql`INSERT INTO commission_statement_returns(
    company_id,id,business_id,statement_id,returned_by,returned_membership_id,reason,created_at)
    VALUES (${tenant.company},${id},${tenant.business},${statementId},${USER},${tenant.membership},
      ${reason},'2026-11-04T06:30:00Z')`);
  return id;
}

it('the returns table carries forced row-level security and only the policies an insert-only ledger needs', async () => {
  const tables = await owner<
    { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]
  >`
    SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
    WHERE relname = 'commission_statement_returns'`;
  expect(tables.map((row) => [row.relname, row.relrowsecurity, row.relforcerowsecurity])).toEqual([
    ['commission_statement_returns', true, true],
  ]);
  const policies = await owner<{ cmd: string }[]>`
    SELECT cmd FROM pg_policies WHERE tablename = 'commission_statement_returns' ORDER BY cmd`;
  expect(policies.map((row) => row.cmd)).toEqual(['INSERT', 'SELECT']);
});

it('CM-33c: company B reads none of the returns of company A and cannot insert one for A', async () => {
  const a = await lockTargetStatement({
    db,
    companyId: A.company,
    businessId: A.business,
    period: '2026-10',
    ids,
  });
  await db.withTenant(A.company, (tx) => insertReturn(tx, A, a));
  expect(await asA(sql`SELECT id FROM commission_statement_returns`)).toHaveLength(1);
  expect(await asB(sql`SELECT id FROM commission_statement_returns`)).toEqual([]);
  // صف على شركة A من جلسة B: سياسة الإدراج بترفض قبل أي مفتاح أجنبي.
  await expectPgError(
    db.withTenant(B.company, (tx) => insertReturn(tx, A, a)),
    '42501',
  );
});

it('CM-33c: a return of another company cannot point at a statement of this company', async () => {
  const a = await lockTargetStatement({
    db,
    companyId: A.company,
    businessId: A.business,
    period: '2026-11',
    ids,
  });
  const b = await lockTargetStatement({
    db,
    companyId: B.company,
    businessId: B.business,
    period: '2026-11',
    ids,
  });
  await expectPgError(
    db.withTenant(B.company, (tx) =>
      tx.execute(sql`INSERT INTO commission_statement_returns(
        company_id,id,business_id,statement_id,returned_by,returned_membership_id,reason,created_at)
        VALUES (${B.company},${ids.newId()},${B.business},${a},${USER},${B.membership},'سبب','2026-11-04T06:30:00Z')`),
    ),
    '23503',
    'commission_statement_returns_statement_fk',
  );
  expect(await asB(sql`SELECT id FROM commission_statement_returns`)).toEqual([]);
  expect(await asA(sql`SELECT id FROM commission_statement_returns`)).toHaveLength(1);
  expect(b).toBeTruthy();
});

it('CM-33c: the returns are insert-only, for the owner of the row and for everybody else', async () => {
  const a = await lockTargetStatement({
    db,
    companyId: A.company,
    businessId: A.business,
    period: '2026-09',
    ids,
  });
  const id = await db.withTenant(A.company, (tx) => insertReturn(tx, A, a));
  await expectPgError(
    asB(sql`UPDATE commission_statement_returns SET reason='سبب تاني' WHERE id = ${id}`),
    '42501',
  );
  await expectPgError(asB(sql`DELETE FROM commission_statement_returns WHERE id = ${id}`), '42501');
  await expectPgError(
    asA(sql`UPDATE commission_statement_returns SET reason='سبب تاني' WHERE id = ${id}`),
    '42501',
  );
  await expectPgError(asA(sql`DELETE FROM commission_statement_returns WHERE id = ${id}`), '42501');
  const [row] = await asA(sql`SELECT reason FROM commission_statement_returns WHERE id = ${id}`);
  expect(row?.['reason']).toBe('خطة سوسن غلط');
});

it('CM-33c: a session with no tenant set reads zero rows and cannot insert', async () => {
  const bare = postgres(testDb.appUrl, { max: 1, onnotice: () => undefined });
  try {
    expect(await bare`SELECT id FROM commission_statement_returns`).toEqual([]);
    await expectPgError(
      bare`INSERT INTO commission_statement_returns(
        company_id,id,business_id,statement_id,returned_by,returned_membership_id,reason,created_at)
        VALUES (${A.company}, ${ids.newId()}, ${A.business}, ${ids.newId()}, ${USER}, ${A.membership},
          'سبب', '2026-11-04T06:30:00Z')`,
      '42501',
    );
  } finally {
    await bare.end();
  }
});

it('the reason is stored once and never updated', async () => {
  const a = await lockTargetStatement({
    db,
    companyId: A.company,
    businessId: A.business,
    period: '2026-08',
    ids,
  });
  const id = await db.withTenant(A.company, (tx) => insertReturn(tx, A, a, 'سبب مختصر'));
  const rows = await asA(
    sql`SELECT reason, returned_by, returned_membership_id FROM commission_statement_returns
      WHERE id = ${id}`,
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]?.['reason']).toBe('سبب مختصر');
  expect(rows[0]?.['returned_by']).toBe(USER);
  expect(rows[0]?.['returned_membership_id']).toBe(A.membership);
});
