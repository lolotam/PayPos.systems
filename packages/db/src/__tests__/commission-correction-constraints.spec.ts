import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createDatabase, type Database } from '../index.ts';
import {
  COMMISSION_TENANT,
  OTHER_COMMISSION_IDS,
  expectPgError,
  seedCommissionStatementTenants,
} from '../../test/commission-statement-fixtures.ts';
import {
  insertCommissionCorrection,
  insertCommissionGeneration,
  lockTargetStatement,
} from '../../test/commission-correction-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';

let testDb: TestDatabase;
let db: Database;
const ids = systemUuidV7();
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

// كشف الشهر الهدف: التصحيح بيتعلّق بيه بالمفتاح المركّب، فمحتاج كشف موجود في نفس النشاط.
const targetStatement = (businessId: string, period: string): Promise<string> =>
  lockTargetStatement({ db, companyId: A.company, businessId, period, ids });

const insertCorrection = (
  statementId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> =>
  db.withTenant(A.company, (tx) => insertCommissionCorrection(tx, A, ids, statementId, overrides));

const insertGeneration = (overrides: Record<string, unknown> = {}): Promise<string> =>
  db.withTenant(A.company, (tx) => insertCommissionGeneration(tx, A, ids, overrides));

it('refuses a correction whose kind is not one of the four sources', async () => {
  const statementId = await targetStatement(A.business, '2026-11');
  await expectPgError(
    insertCorrection(statementId, { kind: 'CARRY_COMMISSION' }),
    '23514',
    'commission_corrections_kind',
  );
});

const MALFORMED_PERIODS = [
  ['source period', { sourcePeriod: '2026-00' }, 'commission_corrections_source_period'],
  [
    'target period',
    { sourcePeriod: '2026-01', targetPeriod: '2026-13' },
    'commission_corrections_target_period',
  ],
] as const;

it.each(MALFORMED_PERIODS)('refuses a malformed %s', async (_label, overrides, constraint) => {
  const statementId = await targetStatement(A.business, '2026-11');
  await expectPgError(insertCorrection(statementId, { ...overrides }), '23514', constraint);
});

it('refuses a malformed generation period', async () => {
  await expectPgError(
    insertGeneration({ period: '2026-13' }),
    '23514',
    'commission_period_generations_period',
  );
});

it('refuses an amount that is not the difference between the new and the previous amount', async () => {
  const statementId = await targetStatement(A.business, '2026-11');
  await expectPgError(
    insertCorrection(statementId, { amount: '6.000' }),
    '23514',
    'commission_corrections_amount',
  );
});

// كل مبلغ لازم يكون رقم حقيقي: NaN بيساوي نفسه في Postgres، فقيد التساوي لوحده
// كان هيقبل الصف؛ القيد على الأعمدة التلاتة هو اللي بيقول غير كده.
const NAN_COLUMNS = [
  ['amount', 'amount'],
  ['previous_amount', 'previousAmount'],
  ['new_amount', 'newAmount'],
] as const;

it.each(NAN_COLUMNS)('refuses a correction whose %s is NaN', async (_column, override) => {
  const statementId = await targetStatement(A.business, '2026-11');
  await expectPgError(insertCorrection(statementId, { [override]: 'NaN' }), '23514');
});

it('refuses a correction whose three amounts are all NaN', async () => {
  const statementId = await targetStatement(A.business, '2026-11');
  await expectPgError(
    insertCorrection(statementId, { amount: 'NaN', previousAmount: 'NaN', newAmount: 'NaN' }),
    '23514',
    'commission_corrections_amounts',
  );
});

it('refuses a correction without a source branch', async () => {
  const statementId = await targetStatement(A.business, '2026-11');
  await expectPgError(insertCorrection(statementId, { sourceBranchId: null }), '23502');
});

it('refuses a correction without a source business date', async () => {
  const statementId = await targetStatement(A.business, '2026-11');
  await expectPgError(insertCorrection(statementId, { sourceBusinessDate: null }), '23502');
});

it('refuses a target period that is not after the source period', async () => {
  const statementId = await targetStatement(A.business, '2026-10');
  await expectPgError(
    insertCorrection(statementId, { sourcePeriod: '2026-11', targetPeriod: '2026-10' }),
    '23514',
    'commission_corrections_target_after_source',
  );
});

it('refuses a generation counter of zero', async () => {
  await expectPgError(
    insertGeneration({ generation: 0 }),
    '23514',
    'commission_period_generations_generation',
  );
});

it('keeps one generation row per employee and period', async () => {
  await insertGeneration({ period: '2026-09' });
  await expectPgError(
    insertGeneration({ period: '2026-09' }),
    '23505',
    'commission_period_generations_employee_period_unique',
  );
});

it('refuses a second correction for the same source, employee and generation', async () => {
  const statementId = await targetStatement(A.business, '2026-11');
  const sourceRef = `line:${ids.newId()}`;
  await insertCorrection(statementId, { sourceRef });
  await expectPgError(
    insertCorrection(statementId, { sourceRef }),
    '23505',
    'commission_corrections_source_key',
  );
});

it('refuses a target statement that belongs to another business', async () => {
  const statementId = await targetStatement(OTHER_COMMISSION_IDS.business, '2026-11');
  await expectPgError(
    insertCorrection(statementId),
    '23503',
    'commission_corrections_target_statement_fk',
  );
});

const FOREIGN_REFERENCES = [
  [
    'an employee of another business',
    { employeeId: OTHER_COMMISSION_IDS.employee },
    'commission_corrections_employee_fk',
  ],
  [
    'a source branch of another business',
    { sourceBranchId: OTHER_COMMISSION_IDS.branch },
    'commission_corrections_source_branch_fk',
  ],
  [
    'an employee of another tenant',
    { employeeId: B.employee },
    'commission_corrections_employee_fk',
  ],
  [
    'a source branch of another tenant',
    { sourceBranchId: B.branch },
    'commission_corrections_source_branch_fk',
  ],
] as const;

it.each(FOREIGN_REFERENCES)('refuses %s', async (_label, overrides, constraint) => {
  const statementId = await targetStatement(A.business, '2026-11');
  await expectPgError(insertCorrection(statementId, { ...overrides }), '23503', constraint);
});

it('bumps the generation and refuses every other update or a delete on the generation row', async () => {
  const generationId = await insertGeneration({ period: '2026-08' });
  await db.withTenant(A.company, (tx) =>
    tx.execute(sql`UPDATE commission_period_generations SET generation=2 WHERE id=${generationId}`),
  );
  expect(
    await db.withTenant(A.company, (tx) =>
      tx.execute(
        sql`SELECT generation FROM commission_period_generations WHERE id=${generationId}`,
      ),
    ),
  ).toEqual([{ generation: 2 }]);
  await expectPgError(
    db.withTenant(A.company, (tx) =>
      tx.execute(
        sql`UPDATE commission_period_generations SET period='2026-12' WHERE id=${generationId}`,
      ),
    ),
    '42501',
  );
  await expectPgError(
    db.withTenant(A.company, (tx) => tx.execute(sql`DELETE FROM commission_period_generations`)),
    '42501',
  );
});

it('takes inserts only on the correction rows', async () => {
  const statementId = await targetStatement(A.business, '2026-11');
  const correctionId = await insertCorrection(statementId);
  await expectPgError(
    db.withTenant(A.company, (tx) =>
      tx.execute(sql`UPDATE commission_corrections SET amount='1.000' WHERE id=${correctionId}`),
    ),
    '42501',
  );
  await expectPgError(
    db.withTenant(A.company, (tx) => tx.execute(sql`DELETE FROM commission_corrections`)),
    '42501',
  );
  expect(
    await db.withTenant(A.company, (tx) =>
      tx.execute(sql`SELECT amount FROM commission_corrections WHERE id=${correctionId}`),
    ),
  ).toEqual([{ amount: '5.000' }]);
});
