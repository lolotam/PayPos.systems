import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createDatabase, type Database } from '../index.ts';
import {
  COMMISSION_TENANT,
  expectPgError,
  insertCommissionLine,
  OTHER_COMMISSION_IDS,
  seedCommissionStatementTenants,
  walkCommissionStatement,
} from '../../test/commission-statement-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { USER } from '../../test/tenancy-fixtures.ts';

// حارسا الصرف على قاعدة بيانات مهاجَرة بالكامل (54-1): صف الدفع بيتقبل في معاملة الدفع بس
// ولموظفة مجمّدة، والاكتمال بيتفحص عند الـ commit، والعزل بين الشريحتين بيفضل قايم.
let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;
const ids = systemUuidV7();
const { A, B } = COMMISSION_TENANT;
let month = 0;

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

/** كشف معتمد بصف EMPLOYEE مجمّد واحد لموظفة A، في شهر جديد لكل اختبار. */
async function approvedStatement(): Promise<{ id: string; period: string }> {
  month += 1;
  const period = `2025-${String(month).padStart(2, '0')}`;
  const id = await walkCommissionStatement(db, {
    tenant: A,
    period,
    ids,
    afterApproved: (tx, statementId) =>
      insertCommissionLine(tx, A, statementId, ids, { kind: 'EMPLOYEE' }),
  });
  return { id, period };
}

const markPaid = (statementId: string, method: string) => sql`UPDATE commission_statements
  SET status='PAID', paid_by=${USER}, paid_at=now(), paid_on='2026-11-03', paid_method=${method}
  WHERE company_id=${A.company} AND id=${statementId}`;

const payment = (statementId: string, employee: string, exact: string, paid: string) => sql`
  INSERT INTO commission_statement_payments(company_id,id,business_id,statement_id,employee_id,exact_payable,paid_amount)
  VALUES (${A.company},${ids.newId()},${A.business},${statementId},${employee},${exact},${paid})`;

const statusOf = async (statementId: string) => {
  const [row] = await owner`SELECT status, payment_xact_id IS NOT NULL AS proven
    FROM commission_statements WHERE id=${statementId}`;
  return row;
};
const paymentCount = async (statementId: string) => {
  const [row] = await owner`SELECT count(*)::int AS n FROM commission_statement_payments WHERE statement_id=${statementId}`;
  return row?.['n'];
};

it('marks paid with one row per frozen employee in one transaction, cash rounded to 5 fils', async () => {
  const { id } = await approvedStatement();
  await db.withTenant(A.company, async (tx) => {
    await tx.execute(markPaid(id, 'CASH'));
    await tx.execute(payment(id, A.employee, '41.003', '41.005'));
  });
  expect(await statusOf(id)).toEqual({ status: 'PAID', proven: true });
  expect(await paymentCount(id)).toBe(1);
});

it('a non-cash payment must equal the exact payable and a cash payment must be rounded', async () => {
  const noncash = await approvedStatement();
  await expectPgError(
    db.withTenant(A.company, async (tx) => {
      await tx.execute(markPaid(noncash.id, 'BANK_TRANSFER'));
      await tx.execute(payment(noncash.id, A.employee, '41.003', '41.005'));
    }),
    '23514',
    'commission_statement_payments_exact_amount',
  );
  const cash = await approvedStatement();
  await expectPgError(
    db.withTenant(A.company, async (tx) => {
      await tx.execute(markPaid(cash.id, 'CASH'));
      await tx.execute(payment(cash.id, A.employee, '41.003', '41.003'));
    }),
    '23514',
    'commission_statement_payments_cash_rounding',
  );
  expect((await statusOf(noncash.id))?.['status']).toBe('APPROVED');
  expect(await paymentCount(noncash.id)).toBe(0);
});

it('a same-company employee absent from the statement is refused', async () => {
  const { id } = await approvedStatement();
  await expectPgError(
    db.withTenant(A.company, async (tx) => {
      await tx.execute(markPaid(id, 'WITH_SALARY'));
      await tx.execute(payment(id, OTHER_COMMISSION_IDS.employee, '1.000', '1.000'));
    }),
    '23514',
    'commission_statement_payments_employee_frozen',
  );
});

it('a payment row is refused outside the transaction that marked the statement paid', async () => {
  const { id } = await approvedStatement();
  await db.withTenant(A.company, async (tx) => {
    await tx.execute(markPaid(id, 'WITH_SALARY'));
    await tx.execute(payment(id, A.employee, '10.000', '10.000'));
  });
  await expectPgError(
    db.withTenant(A.company, (tx) => tx.execute(payment(id, A.employee, '10.000', '10.000'))),
    '23514',
    'commission_statement_payments_paid_by_transition',
  );
  const approved = await approvedStatement();
  await expectPgError(
    db.withTenant(A.company, (tx) => tx.execute(payment(approved.id, A.employee, '1.000', '1.000'))),
    '23514',
    'commission_statement_payments_paid_by_transition',
  );
});

it('marking paid with a row left out fails at commit and the statement stays APPROVED with no payment row', async () => {
  const { id } = await approvedStatement();
  await expectPgError(
    db.withTenant(A.company, (tx) => tx.execute(markPaid(id, 'WITH_SALARY'))),
    '23514',
    'commission_statements_payment_complete',
  );
  expect(await statusOf(id)).toEqual({ status: 'APPROVED', proven: false });
  expect(await paymentCount(id)).toBe(0);
});

it('the payment columns and the proof cannot be written outside the transition', async () => {
  const { id } = await approvedStatement();
  await expectPgError(
    owner`UPDATE commission_statements SET paid_method='CASH' WHERE id=${id}`,
    '23514',
    'commission_statements_approved_frozen',
  );
  await expectPgError(
    db.withTenant(A.company, (tx) =>
      tx.execute(sql`UPDATE commission_statements SET payment_xact_id = '1' WHERE id = ${id}`),
    ),
    '42501',
  );
});

it('company B reads none of company A payment rows and cannot insert for A', async () => {
  const { id } = await approvedStatement();
  await db.withTenant(A.company, async (tx) => {
    await tx.execute(markPaid(id, 'WITH_SALARY'));
    await tx.execute(payment(id, A.employee, '5.000', '5.000'));
  });
  const seen = await db.withTenant(B.company, (tx) =>
    tx.execute(sql`SELECT id FROM commission_statement_payments`),
  );
  expect(seen).toHaveLength(0);
  await expectPgError(
    db.withTenant(B.company, (tx) => tx.execute(payment(id, A.employee, '5.000', '5.000'))),
    '23503',
  );
});

async function paidStatement(): Promise<string> {
  const { id } = await approvedStatement();
  await db.withTenant(A.company, async (tx) => {
    await tx.execute(markPaid(id, 'WITH_SALARY'));
    await tx.execute(payment(id, A.employee, '7.000', '7.000'));
  });
  return id;
}

it('a payment row is never updated or deleted, by the app role', async () => {
  const id = await paidStatement();
  await expectPgError(
    db.withTenant(A.company, (tx) =>
      tx.execute(sql`UPDATE commission_statement_payments SET paid_amount = '8.000' WHERE statement_id = ${id}`),
    ),
    '42501',
  );
  await expectPgError(
    db.withTenant(A.company, (tx) =>
      tx.execute(sql`DELETE FROM commission_statement_payments WHERE statement_id = ${id}`),
    ),
    '42501',
  );
  expect(await paymentCount(id)).toBe(1);
});

it('a paid statement never changes again, not even its note, and cannot be paid twice', async () => {
  const id = await paidStatement();
  await expectPgError(
    db.withTenant(A.company, (tx) =>
      tx.execute(sql`UPDATE commission_statements SET paid_note = 'later' WHERE id = ${id}`),
    ),
    '23514',
    'commission_statements_paid_immutable',
  );
  await expectPgError(
    db.withTenant(A.company, (tx) => tx.execute(markPaid(id, 'CASH'))),
    '23514',
    'commission_statements_paid_immutable',
  );
  expect(await statusOf(id)).toEqual({ status: 'PAID', proven: true });
});

it('only a paid statement carries payment columns, and only an approved one becomes paid', async () => {
  const reviewed = await walkCommissionStatement(db, { tenant: A, period: '2024-01', ids, to: 'REVIEWED' });
  await expectPgError(
    owner`UPDATE commission_statements SET paid_by = ${USER} WHERE id = ${reviewed}`,
    '23514',
    'commission_statements_payment_stage',
  );
  await expectPgError(
    db.withTenant(A.company, (tx) => tx.execute(markPaid(reviewed, 'CASH'))),
    '23514',
    'commission_statements_transition',
  );
});
