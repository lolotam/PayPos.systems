import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createDatabase, lockStatementPeriods, type Database } from '../index.ts';
import {
  COMMISSION_TENANT,
  expectPgError,
  insertCommissionAttachment,
  insertCommissionLine,
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

const frozenLine = (company: string, business: string, statementId: string, employee: string) =>
  sql`INSERT INTO commission_statement_lines(company_id,id,business_id,statement_id,employee_id,
    employee_number,employee_name_en,source_ref,kind,amount)
    VALUES(${company},${ids.newId()},${business},${statementId},${employee},1,'Frozen employee',
      ${`probe:${ids.newId()}`},'EMPLOYEE','0.000')`;

it('the three tables carry forced row-level security and the policies the app needs', async () => {
  const tables = await owner<
    { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]
  >`
    SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
    WHERE relname IN ('commission_statements','commission_statement_lines','commission_statement_attachments')
    ORDER BY relname`;
  expect(tables.map((row) => [row.relname, row.relrowsecurity, row.relforcerowsecurity])).toEqual([
    ['commission_statement_attachments', true, true],
    ['commission_statement_lines', true, true],
    ['commission_statements', true, true],
  ]);
  const policies = await owner<{ tablename: string; cmd: string }[]>`
    SELECT tablename, cmd FROM pg_policies
    WHERE tablename IN ('commission_statements','commission_statement_lines','commission_statement_attachments')
    ORDER BY tablename, cmd`;
  expect(policies).toEqual([
    { tablename: 'commission_statement_attachments', cmd: 'INSERT' },
    { tablename: 'commission_statement_attachments', cmd: 'SELECT' },
    { tablename: 'commission_statement_lines', cmd: 'INSERT' },
    { tablename: 'commission_statement_lines', cmd: 'SELECT' },
    { tablename: 'commission_statements', cmd: 'INSERT' },
    { tablename: 'commission_statements', cmd: 'SELECT' },
    { tablename: 'commission_statements', cmd: 'UPDATE' },
  ]);
});

it('CM-04: company B reads, locks and creates nothing of company A', async () => {
  const statementId = await walkCommissionStatement(db, { tenant: A, period: '2026-10', ids });
  expect(await asA(sql`SELECT id FROM commission_statements WHERE id=${statementId}`)).toHaveLength(
    1,
  );
  expect(await asB(sql`SELECT id FROM commission_statements`)).toEqual([]);
  expect(await asB(sql`SELECT id FROM commission_statements WHERE id=${statementId}`)).toEqual([]);
  // القفل على صف شركة تانية مالهوش سطر، فمفيش قفل بيتاخد أصلاً.
  expect(
    await asB(sql`SELECT id FROM commission_statements WHERE id=${statementId} FOR UPDATE`),
  ).toEqual([]);
  // كشف لنشاط شركة تانية: المفتاح الأجنبي بيرفض قبل ما الصف يتكتب.
  await expectPgError(
    db.withTenant(B.company, (tx) =>
      lockStatementPeriods(tx, { businessId: A.business, periods: ['2026-11'], ids }),
    ),
    '23503',
    'commission_statements_business_fk',
  );
  // وصف شركة تانية مرفوض بسياسة الإدراج.
  await expectPgError(
    asB(sql`INSERT INTO commission_statements(company_id,id,business_id,period,status)
      VALUES(${A.company},${ids.newId()},${A.business},'2026-12','DRAFT')`),
    '42501',
  );
  expect(await asA(sql`SELECT id FROM commission_statements WHERE period='2026-11'`)).toEqual([]);
});

it('CM-R08: company B reads and writes none of the frozen rows of company A', async () => {
  const statementId = await walkCommissionStatement(db, {
    tenant: A,
    period: '2026-12',
    ids,
    afterApproved: async (tx, id) => {
      await insertCommissionLine(tx, A, id, ids);
      await insertCommissionAttachment(tx, A, id, ids);
    },
  });
  expect(await asA(sql`SELECT id FROM commission_statement_lines`)).toHaveLength(1);
  expect(await asA(sql`SELECT id FROM commission_statement_attachments`)).toHaveLength(1);
  expect(await asB(sql`SELECT id FROM commission_statement_lines`)).toEqual([]);
  expect(await asB(sql`SELECT id FROM commission_statement_attachments`)).toEqual([]);
  // صف على شركة تانية: تريغر التجميد بيشتغل قبل سياسة الإدراج، وهو مش شايف كشف شركة A من جلسة B،
  // فبيرفع خطأ المفتاح الأجنبي بتاع الجدول نفسه.
  await expectPgError(
    asB(frozenLine(A.company, A.business, statementId, A.employee)),
    '23503',
    'commission_statement_lines_statement_fk',
  );
  // صف على كشف شركة تانية: نفس المسار ونفس القيد.
  await expectPgError(
    asB(frozenLine(B.company, B.business, statementId, B.employee)),
    '23503',
    'commission_statement_lines_statement_fk',
  );
  await expectPgError(
    asB(sql`INSERT INTO commission_statement_attachments(company_id,id,business_id,statement_id,employee_id,
      branch_id,attached_from,attached_to)
      VALUES(${A.company},${ids.newId()},${A.business},${statementId},${A.employee},${A.branch},
        '2026-10-01','2026-10-31')`),
    '23503',
    'commission_statement_attachments_statement_fk',
  );
  expect(await asA(sql`SELECT id FROM commission_statement_lines`)).toHaveLength(1);
  expect(await asA(sql`SELECT id FROM commission_statement_attachments`)).toHaveLength(1);
});

it('the application role may not delete, truncate or re-home a statement', async () => {
  const statementId = await walkCommissionStatement(db, { tenant: A, period: '2027-01', ids });
  await expectPgError(asA(sql`DELETE FROM commission_statements WHERE id=${statementId}`), '42501');
  await expectPgError(asA(sql`TRUNCATE commission_statements`), '42501');
  await expectPgError(
    asA(sql`UPDATE commission_statements SET period='2027-02' WHERE id=${statementId}`),
    '42501',
  );
  await expectPgError(
    asA(sql`UPDATE commission_statements SET business_id=${B.business} WHERE id=${statementId}`),
    '42501',
  );
  await expectPgError(
    asA(sql`UPDATE commission_statements SET approval_xact_id='1'::xid8 WHERE id=${statementId}`),
    '42501',
  );
  await expectPgError(
    asA(sql`UPDATE commission_statements SET created_at=now() WHERE id=${statementId}`),
    '42501',
  );
  expect(await asA(sql`SELECT id FROM commission_statements WHERE id=${statementId}`)).toHaveLength(
    1,
  );
});

it('the frozen tables take inserts only', async () => {
  const statementId = await walkCommissionStatement(db, {
    tenant: A,
    period: '2027-03',
    ids,
    afterApproved: async (tx, id) => {
      await insertCommissionLine(tx, A, id, ids);
      await insertCommissionAttachment(tx, A, id, ids);
    },
  });
  await expectPgError(
    asA(
      sql`UPDATE commission_statement_lines SET amount='1.000' WHERE statement_id=${statementId}`,
    ),
    '42501',
  );
  await expectPgError(asA(sql`DELETE FROM commission_statement_lines`), '42501');
  await expectPgError(asA(sql`TRUNCATE commission_statement_lines`), '42501');
  await expectPgError(
    asA(sql`UPDATE commission_statement_attachments SET attached_to='2026-10-30'
      WHERE statement_id=${statementId}`),
    '42501',
  );
  await expectPgError(asA(sql`DELETE FROM commission_statement_attachments`), '42501');
  await expectPgError(asA(sql`TRUNCATE commission_statement_attachments`), '42501');
  expect(
    await asA(sql`SELECT amount FROM commission_statement_lines WHERE statement_id=${statementId}`),
  ).toEqual([{ amount: '0.000' }]);
});
