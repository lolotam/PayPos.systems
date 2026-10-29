import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createDatabase, type Database } from '../index.ts';
import {
  COMMISSION_TENANT,
  expectPgError,
  insertStatementExport,
  seedCommissionStatementTenants,
  walkCommissionStatement,
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

it('the export table carries forced row-level security and the policies the app needs', async () => {
  const tables = await owner<
    { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]
  >`
    SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
    WHERE relname = 'commission_statement_exports'`;
  expect(tables.map((row) => [row.relname, row.relrowsecurity, row.relforcerowsecurity])).toEqual([
    ['commission_statement_exports', true, true],
  ]);
  const policies = await owner<{ tablename: string; cmd: string }[]>`
    SELECT tablename, cmd FROM pg_policies WHERE tablename = 'commission_statement_exports' ORDER BY cmd`;
  expect(policies).toEqual([
    { tablename: 'commission_statement_exports', cmd: 'INSERT' },
    { tablename: 'commission_statement_exports', cmd: 'SELECT' },
    { tablename: 'commission_statement_exports', cmd: 'UPDATE' },
  ]);
});

it('CM-R10: company B reads and writes none of the export rows of company A', async () => {
  const period = '2026-10';
  const statementId = await walkCommissionStatement(db, { tenant: A, period, ids });
  const exportId = await db.withTenant(A.company, (tx) =>
    insertStatementExport(tx, { tenant: A, statementId, period, ids }),
  );
  expect(
    await asA(sql`SELECT id FROM commission_statement_exports WHERE id=${exportId}`),
  ).toHaveLength(1);
  expect(await asB(sql`SELECT id FROM commission_statement_exports`)).toEqual([]);
  expect(await asB(sql`SELECT id FROM commission_statement_exports WHERE id=${exportId}`)).toEqual(
    [],
  );
  // صف على شركة تانية: تريغر الإدراج بيشتغل قبل سياسة الإدراج، وهو مش شايف كشف شركة A من جلسة B،
  // فبيرفع خطأ المفتاح الأجنبي بتاع الجدول نفسه.
  await expectPgError(
    db.withTenant(B.company, (tx) =>
      insertStatementExport(tx, { tenant: A, statementId, period, ids }, { companyId: A.company }),
    ),
    '23503',
    'commission_statement_exports_statement_fk',
  );
  // تحديث وقت التحميل من جلسة شركة تانية: مفيش صف مرئي، فمفيش سطر اتغيّر.
  await asB(sql`UPDATE commission_statement_exports SET collected_at=now() WHERE id=${exportId}`);
  expect(
    await asA(sql`SELECT collected_at FROM commission_statement_exports WHERE id=${exportId}`),
  ).toEqual([{ collected_at: null }]);
  expect(await asA(sql`SELECT id FROM commission_statement_exports`)).toHaveLength(1);
});

it('the application role may not delete, truncate or re-home an export request', async () => {
  const period = '2026-12';
  const statementId = await walkCommissionStatement(db, { tenant: A, period, ids });
  const exportId = await db.withTenant(A.company, (tx) =>
    insertStatementExport(tx, { tenant: A, statementId, period, ids }),
  );
  await expectPgError(asA(sql`DELETE FROM commission_statement_exports`), '42501');
  await expectPgError(asA(sql`TRUNCATE commission_statement_exports`), '42501');
  // غير وقت التحميل مفيش UPDATE للتطبيق أصلاً: الصلاحية بتتحدد على مستوى العمود.
  await expectPgError(
    asA(sql`UPDATE commission_statement_exports SET scope='BRANCHES' WHERE id=${exportId}`),
    '42501',
  );
  await expectPgError(
    asA(sql`UPDATE commission_statement_exports SET requested_at=now() WHERE id=${exportId}`),
    '42501',
  );
  await expectPgError(
    asA(sql`UPDATE commission_statement_exports SET company_id=${B.company} WHERE id=${exportId}`),
    '42501',
  );
  expect(
    await asA(sql`SELECT id FROM commission_statement_exports WHERE id=${exportId}`),
  ).toHaveLength(1);
});
