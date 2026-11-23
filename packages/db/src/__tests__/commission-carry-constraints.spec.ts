import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type Database } from '../index.ts';
import { insertCommissionCarry } from '../../test/commission-carry-fixtures.ts';
import { lockTargetStatement } from '../../test/commission-correction-fixtures.ts';
import {
  COMMISSION_TENANT,
  expectPgError,
  OTHER_COMMISSION_IDS,
  seedCommissionStatementTenants,
} from '../../test/commission-statement-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';

let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;
const ids = systemUuidV7();
const { A } = COMMISSION_TENANT;
let source = '';
let target = '';
let other = '';
let older = '';

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedCommissionStatementTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids });
  const request = { db, companyId: A.company, businessId: A.business, ids };
  source = await lockTargetStatement({ ...request, period: '2026-10' });
  target = await lockTargetStatement({ ...request, period: '2026-11' });
  older = await lockTargetStatement({ ...request, period: '2026-08' });
  other = await lockTargetStatement({
    ...request,
    businessId: OTHER_COMMISSION_IDS.business,
    period: '2026-10',
  });
});
afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

const insert = (values: Parameters<typeof insertCommissionCarry>[3]) =>
  db.withTenant(A.company, (tx) => insertCommissionCarry(tx, A, ids, values));

describe('the commission_carries constraints (D-22)', () => {
  it('refuses a carry that is zero or positive, because only a negative balance is carried', async () => {
    const base = { sourceStatementId: source, targetStatementId: target };
    await expectPgError(insert({ ...base, amount: '0.000' }), '23514', 'commission_carries_amount');
    await expectPgError(insert({ ...base, amount: '5.000' }), '23514', 'commission_carries_amount');
  });

  it('refuses a kind other than COMMISSION and TIP_CARD, which an append-only ledger could never repair', async () => {
    const base = { sourceStatementId: source, targetStatementId: target };
    await expectPgError(insert({ ...base, kind: 'TIP_CASH' }), '23514', 'commission_carries_kind');
    await expectPgError(insert({ ...base, kind: 'commission' }), '23514', 'commission_carries_kind');
    await expectPgError(insert({ ...base, kind: '' }), '23514', 'commission_carries_kind');
  });

  it('refuses a target month that is not after the source month', async () => {
    await expectPgError(
      insert({
        sourceStatementId: source,
        targetStatementId: source,
        targetPeriod: '2026-10',
      }),
      '23514',
      'commission_carries_target_after_source',
    );
    await expectPgError(
      insert({
        sourceStatementId: target,
        targetStatementId: source,
        sourcePeriod: '2026-11',
        targetPeriod: '2026-10',
      }),
      '23514',
      'commission_carries_target_after_source',
    );
  });

  it('keeps one carry per kind and employee in a source statement, and lets both kinds coexist (BR-06)', async () => {
    const base = { sourceStatementId: source, targetStatementId: target };
    await insert({ ...base, kind: 'COMMISSION' });
    await insert({ ...base, kind: 'TIP_CARD', amount: '-2.000' });
    await expectPgError(
      insert({ ...base, kind: 'COMMISSION', amount: '-1.000' }),
      '23505',
      'commission_carries_source_key',
    );
    const rows = await db.withTenant(A.company, (tx) =>
      tx.execute(sql`SELECT kind, amount::text AS amount FROM commission_carries ORDER BY kind`),
    );
    expect(rows).toEqual([
      { kind: 'COMMISSION', amount: '-25.000' },
      { kind: 'TIP_CARD', amount: '-2.000' },
    ]);
  });
});

describe('the commission_carries foreign keys', () => {
  it('refuses a statement of another business of the same company', async () => {
    await expectPgError(
      insert({ sourceStatementId: other, targetStatementId: target, kind: 'TIP_CARD' }),
      '23503',
      'commission_carries_source_statement_fk',
    );
  });

  it('refuses a statement id recorded for another month than the carry says', async () => {
    await expectPgError(
      insert({ sourceStatementId: older, targetStatementId: target, sourcePeriod: '2026-09' }),
      '23503',
      'commission_carries_source_statement_fk',
    );
  });

  it('refuses an employee of another business of the same company', async () => {
    await expectPgError(
      insert({
        sourceStatementId: source,
        targetStatementId: target,
        kind: 'TIP_CARD',
        employeeId: OTHER_COMMISSION_IDS.employee,
      }),
      '23503',
      'commission_carries_employee_fk',
    );
  });

  it('has an index on the exact columns of every foreign key of the table', async () => {
    const missing = await owner<{ conname: string }[]>`
      SELECT c.conname FROM pg_constraint c
      WHERE c.conrelid = 'commission_carries'::regclass AND c.contype = 'f'
        AND NOT EXISTS (
          SELECT 1 FROM pg_index i
          WHERE i.indrelid = c.conrelid
            AND (string_to_array(i.indkey::text, ' ')::int2[])[1:cardinality(c.conkey)] = c.conkey)
      ORDER BY 1`;
    expect(missing).toEqual([]);
  });
});
