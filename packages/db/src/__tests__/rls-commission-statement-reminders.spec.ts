import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createDatabase, type Database } from '../index.ts';
import {
  COMMISSION_TENANT,
  expectPgError,
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

const insertReminder = (
  company: string,
  business: string,
  statementId: string,
  kind: string,
  reminderDate: string,
  recipientCount: number,
) => sql`INSERT INTO commission_statement_reminders(
    company_id,id,business_id,statement_id,kind,reminder_date,recipient_count)
    VALUES(${company},${ids.newId()},${business},${statementId},${kind},${reminderDate},${recipientCount})`;

it('the reminders table carries forced row-level security and the app policies', async () => {
  const tables = await owner<
    { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]
  >`
    SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
    WHERE relname = 'commission_statement_reminders'`;
  expect(tables.map((row) => [row.relname, row.relrowsecurity, row.relforcerowsecurity])).toEqual([
    ['commission_statement_reminders', true, true],
  ]);
  const policies = await owner<{ tablename: string; cmd: string }[]>`
    SELECT tablename, cmd FROM pg_policies WHERE tablename = 'commission_statement_reminders'
    ORDER BY cmd`;
  expect(policies).toEqual([
    { tablename: 'commission_statement_reminders', cmd: 'INSERT' },
    { tablename: 'commission_statement_reminders', cmd: 'SELECT' },
  ]);
});

it('CM-R09: company B reads none of the reminders of company A', async () => {
  const statementId = await walkCommissionStatement(db, { tenant: A, period: '2026-10', ids });
  await asA(insertReminder(A.company, A.business, statementId, 'REVIEW_DAY3', '2026-10-03', 3));
  expect(await asA(sql`SELECT id FROM commission_statement_reminders`)).toHaveLength(1);
  expect(await asB(sql`SELECT id FROM commission_statement_reminders`)).toEqual([]);
  expect(
    await asB(sql`SELECT id FROM commission_statement_reminders WHERE statement_id=${statementId}`),
  ).toEqual([]);
});

it('CM-R09: a cross-tenant insert is refused by the insert policy', async () => {
  const statementId = await walkCommissionStatement(db, { tenant: A, period: '2026-11', ids });
  await expectPgError(
    asB(insertReminder(A.company, A.business, statementId, 'REVIEW_DAY3', '2026-11-03', 1)),
    '42501',
  );
  expect(
    await asA(sql`SELECT id FROM commission_statement_reminders WHERE statement_id=${statementId}`),
  ).toEqual([]);
});

it('CM-R09: a reminder of another company statement is refused by the foreign key', async () => {
  const statementA = await walkCommissionStatement(db, { tenant: A, period: '2026-12', ids });
  const statementB = await walkCommissionStatement(db, { tenant: B, period: '2026-12', ids });
  await expectPgError(
    asB(insertReminder(B.company, B.business, statementA, 'REVIEW_DAY3', '2026-12-03', 1)),
    '23503',
    'commission_statement_reminders_statement_fk',
  );
  await expectPgError(
    asA(insertReminder(A.company, A.business, statementB, 'REVIEW_DAY3', '2026-12-03', 1)),
    '23503',
    'commission_statement_reminders_statement_fk',
  );
  expect(
    await asA(sql`SELECT id FROM commission_statement_reminders
      WHERE statement_id IN (${statementA}, ${statementB})`),
  ).toEqual([]);
});

it('the reminders table takes inserts only', async () => {
  const statementId = await walkCommissionStatement(db, { tenant: A, period: '2027-01', ids });
  await asA(insertReminder(A.company, A.business, statementId, 'APPROVAL_DAY3', '2027-01-03', 2));
  await expectPgError(
    asA(sql`UPDATE commission_statement_reminders SET recipient_count=5
      WHERE statement_id=${statementId}`),
    '42501',
  );
  await expectPgError(asA(sql`DELETE FROM commission_statement_reminders`), '42501');
  await expectPgError(asA(sql`TRUNCATE commission_statement_reminders`), '42501');
  expect(
    await asA(sql`SELECT recipient_count FROM commission_statement_reminders
      WHERE statement_id=${statementId}`),
  ).toEqual([{ recipient_count: 2 }]);
});

it('one reminder per statement, kind and date', async () => {
  const statementId = await walkCommissionStatement(db, { tenant: A, period: '2027-02', ids });
  await asA(insertReminder(A.company, A.business, statementId, 'APPROVAL_DAY5', '2027-02-05', 1));
  await expectPgError(
    asA(insertReminder(A.company, A.business, statementId, 'APPROVAL_DAY5', '2027-02-05', 1)),
    '23505',
    'commission_statement_reminders_once_key',
  );
  // نفس التاريخ ونوع تاني: سطر تاني legit.
  await asA(insertReminder(A.company, A.business, statementId, 'REVIEW_DAY3', '2027-02-05', 1));
  expect(
    await asA(sql`SELECT kind FROM commission_statement_reminders WHERE statement_id=${statementId}
      ORDER BY kind`),
  ).toEqual([{ kind: 'APPROVAL_DAY5' }, { kind: 'REVIEW_DAY3' }]);
});

it('the kind and the recipient count are constrained', async () => {
  const statementId = await walkCommissionStatement(db, { tenant: A, period: '2027-03', ids });
  await expectPgError(
    asA(insertReminder(A.company, A.business, statementId, 'REVIEW_DAY9', '2027-03-03', 1)),
    '23514',
    'commission_statement_reminders_kind',
  );
  await expectPgError(
    asA(insertReminder(A.company, A.business, statementId, 'REVIEW_DAY3', '2027-03-03', -1)),
    '23514',
    'commission_statement_reminders_recipient_count',
  );
});
