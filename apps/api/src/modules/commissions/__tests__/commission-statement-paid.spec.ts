import { markCommissionStatementPaidResponse } from '@pospay/contracts';
import { lockStatementPeriods } from '@pospay/db';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  ids,
  markPaidInput,
  memberWithoutPayPermission,
  statementPayFixture,
  type StatementPayFixture,
} from './commission-statement-paid.fixture.ts';

let f: StatementPayFixture;
beforeAll(async () => {
  f = await statementPayFixture();
});
afterAll(async () => {
  await f.close();
});

const statementRow = async (statementId: string) => {
  const [row] = await f.h.owner`SELECT status, paid_by, paid_at, to_char(paid_on,'YYYY-MM-DD') AS paid_on,
      paid_method, paid_note FROM commission_statements WHERE id=${statementId}`;
  return row;
};

const paymentRows = async (statementId: string) =>
  f.h.owner`SELECT employee_id, exact_payable::text AS exact_payable, paid_amount::text AS paid_amount
    FROM commission_statement_payments WHERE statement_id=${statementId} ORDER BY employee_id`;

const paidAudits = async (statementId: string) =>
  f.h.owner`SELECT actor_user_id, after FROM audit_log
    WHERE entity='commission_statement' AND entity_id=${statementId}
      AND action='commission_statement.paid'`;

const frozenAmounts = async (statementId: string) =>
  f.h.owner`SELECT kind, amount::text AS amount FROM commission_statement_lines
    WHERE statement_id=${statementId} ORDER BY kind`;

it('CM-40 marks an approved month paid in cash with the rounded payable per employee', async () => {
  const statementId = await f.approvedStatementWithCommission('2026-10');
  const before = await frozenAmounts(statementId);
  const response = await f.pay('2026-10', markPaidInput(), 'cm-40-cash');
  expect(response.status).toBe(200);
  const body = markCommissionStatementPaidResponse.parse(response.body);
  expect(body).toMatchObject({
    business_id: f.business,
    period: '2026-10',
    status: 'PAID',
    paid_by: f.userId,
    paid_on: '2026-11-03',
    paid_method: 'CASH',
    paid_total: '41.005',
    payments: [{ employee_id: f.employee, exact_payable: '41.003', paid_amount: '41.005' }],
  });
  // وقت التسجيل من ساعة قاعدة البيانات زي approved_at (FR-037)، مش من ساعة الاختبار المحقونة.
  expect(Math.abs(Date.parse(body.paid_at) - Date.now())).toBeLessThan(10 * 60_000);
  const stored = await statementRow(statementId);
  expect(stored).toMatchObject({
    status: 'PAID',
    paid_by: f.userId,
    paid_on: '2026-11-03',
    paid_method: 'CASH',
    paid_note: 'مع المرتب نهاية الشهر',
  });
  expect(new Date(stored?.['paid_at'] as Date).toISOString()).toBe(body.paid_at);
  expect(await paymentRows(statementId)).toEqual([
    { employee_id: f.employee, exact_payable: '41.003', paid_amount: '41.005' },
  ]);
  // ما في الكشف المجمّد ما يتغيّر عند الصرف (CM-40).
  expect(await frozenAmounts(statementId)).toEqual(before);
  const audits = await paidAudits(statementId);
  expect(audits).toHaveLength(1);
  expect(audits[0]?.['actor_user_id']).toBe(f.userId);
  const after = audits[0]?.['after'] as Record<string, unknown>;
  expect(after).toMatchObject({ period: '2026-10', paid_on: '2026-11-03', paid_total: '41.005' });
  expect(after['paid_at']).toBe(body.paid_at);
});

it('CM-40 a non-cash payment pays the exact payable with no rounding', async () => {
  const withSalary = await f.approvedStatementWithCommission('2026-11');
  const salary = await f.pay(
    '2026-11',
    markPaidInput({ paid_method: 'WITH_SALARY', paid_note: undefined }),
    'cm-40-salary',
  );
  expect(salary.status).toBe(200);
  expect(salary.body['paid_total']).toBe('41.003');
  expect(await paymentRows(withSalary)).toEqual([
    { employee_id: f.employee, exact_payable: '41.003', paid_amount: '41.003' },
  ]);
  const transfer = await f.approvedStatementWithCommission('2026-12');
  const bank = await f.pay(
    '2026-12',
    markPaidInput({ paid_method: 'BANK_TRANSFER' }),
    'cm-40-bank',
  );
  expect(bank.status).toBe(200);
  expect(await paymentRows(transfer)).toEqual([
    { employee_id: f.employee, exact_payable: '41.003', paid_amount: '41.003' },
  ]);
});

it('CM-41 a draft or a reviewed month is refused and nothing is written', async () => {
  const draftPeriod = '2027-01';
  const [draftStatement] = await f.db.withTenant(f.company, (tx) =>
    lockStatementPeriods(tx, { businessId: f.business, periods: [draftPeriod], ids }),
  );
  if (draftStatement === undefined) throw new Error('the draft statement is missing');
  const draft = await f.pay(draftPeriod, markPaidInput(), 'cm-41-draft');
  expect([draft.status, draft.body['code']]).toEqual([409, 'COMMISSION_STATEMENT_NOT_APPROVED']);
  expect((await statementRow(draftStatement.statementId))?.['status']).toBe('DRAFT');
  expect(await paidAudits(draftStatement.statementId)).toHaveLength(0);
  expect(await paymentRows(draftStatement.statementId)).toHaveLength(0);
  const reviewed = await f.reviewedStatement('2027-02');
  const refused = await f.pay('2027-02', markPaidInput(), 'cm-41-reviewed');
  expect([refused.status, refused.body['code']]).toEqual([409, 'COMMISSION_STATEMENT_NOT_APPROVED']);
  expect((await statementRow(reviewed))?.['status']).toBe('REVIEWED');
});

it('CM-41 a replayed request returns the original response and a different body is 422', async () => {
  const statementId = await f.approvedStatementWithCommission('2027-03');
  const body = markPaidInput();
  const first = await f.pay('2027-03', body, 'cm-41-replay');
  expect(first.status).toBe(200);
  const replay = await f.pay('2027-03', body, 'cm-41-replay');
  expect(replay.status).toBe(first.status);
  expect(replay.body).toEqual(first.body);
  expect(await paymentRows(statementId)).toHaveLength(1);
  expect(await paidAudits(statementId)).toHaveLength(1);
  const reused = await f.pay(
    '2027-03',
    markPaidInput({ paid_note: 'جسم مختلف' }),
    'cm-41-replay',
  );
  expect([reused.status, reused.body['code']]).toEqual([422, 'IDEMPOTENCY_KEY_REUSED']);
  const secondKey = await f.pay('2027-03', body, 'cm-41-second-key');
  expect([secondKey.status, secondKey.body['code']]).toEqual([
    409,
    'COMMISSION_STATEMENT_ALREADY_PAID',
  ]);
  expect(await paymentRows(statementId)).toHaveLength(1);
  expect(await paidAudits(statementId)).toHaveLength(1);
});

it('CM-41 the payout date must not precede the approval date or follow today (FR-037)', async () => {
  const early = await f.approvedStatementWithCommission('2027-09');
  const before = await f.pay('2027-09', markPaidInput({ paid_on: '2026-11-01' }), 'cm-41-early');
  expect([before.status, before.body['code']]).toEqual([422, 'COMMISSION_PAID_ON_INVALID']);
  expect((await statementRow(early))?.['status']).toBe('APPROVED');
  expect(await paymentRows(early)).toHaveLength(0);
  await f.approvedStatementWithCommission('2027-04');
  const future = await f.pay('2027-04', markPaidInput({ paid_on: '2027-05-01' }), 'cm-41-future');
  expect([future.status, future.body['code']]).toEqual([422, 'COMMISSION_PAID_ON_INVALID']);
});

it('CM-42 a caller without pay:commissions:business is refused with the uniform 403', async () => {
  const statementId = await f.approvedStatementWithCommission('2027-06');
  const other = await memberWithoutPayPermission(f);
  const response = await f.pay('2027-06', markPaidInput(), 'cm-42-forbidden', other.cookie);
  expect([response.status, response.body['code']]).toEqual([403, 'FORBIDDEN']);
  expect((await statementRow(statementId))?.['status']).toBe('APPROVED');
  expect(await paymentRows(statementId)).toHaveLength(0);
  expect(await paidAudits(statementId)).toHaveLength(0);
});

it('the payment proof is the paying transaction and the writes stay in the caller tenant', async () => {
  const statementId = await f.approvedStatementWithCommission('2027-07');
  const beforeTenants = f.h.calls.tenant.length;
  const response = await f.pay('2027-07', markPaidInput(), 'cm-tenant');
  expect(response.status).toBe(200);
  const tenants = f.h.calls.tenant.slice(beforeTenants);
  expect(tenants.length).toBeGreaterThan(0);
  expect(tenants.every((tenant) => tenant === f.company)).toBe(true);
  const [row] = await f.h.owner`SELECT payment_xact_id IS NOT NULL AS proven
    FROM commission_statements WHERE id=${statementId}`;
  expect(row?.['proven']).toBe(true);
  expect(await paymentRows(statementId)).toHaveLength(1);
});

it('a malformed method or a missing date is refused before any write', async () => {
  const statementId = await f.approvedStatementWithCommission('2027-08');
  const invalid = await f.pay(
    '2027-08',
    { paid_method: 'CHEQUE' as never, paid_on: '2026-11-03' },
    'cm-invalid-method',
  );
  expect(invalid.status).toBe(400);
  const missingDate = await f.pay(
    '2027-08',
    { paid_method: 'CASH' } as never,
    'cm-missing-date',
  );
  expect(missingDate.status).toBe(400);
  expect((await statementRow(statementId))?.['status']).toBe('APPROVED');
  expect(await paymentRows(statementId)).toHaveLength(0);
});

it('pays a statement whose total passes the single-row bound while each employee stays inside it', async () => {
  const sixty = '60000000000.000';
  const statementId = await f.approvedStatementWith('2027-10', [
    { employee: f.employee, amounts: [sixty] },
    { employee: f.secondEmployee, amounts: [sixty] },
  ]);
  const response = await f.pay('2027-10', markPaidInput({ paid_method: 'WITH_SALARY' }), 'big-total');
  expect(response.status).toBe(200);
  const body = markCommissionStatementPaidResponse.parse(response.body);
  expect(body.paid_total).toBe('120000000000.000');
  expect(body.payments.map((row) => row.paid_amount)).toEqual([sixty, sixty]);
  expect((await statementRow(statementId))?.['status']).toBe('PAID');
  expect(await paymentRows(statementId)).toHaveLength(2);
});

it.each([
  ['one employee payable above the stored bound', 'WITH_SALARY', ['60000000000.000', '60000000000.000']],
  ['a cash rounding above the stored bound', 'CASH', ['99999999999.999']],
] as const)('refuses %s with 422 COMMISSION_PAYABLE_TOO_LARGE and writes nothing', async (_name, method, amounts) => {
  const period = method === 'CASH' ? '2027-12' : '2027-11';
  const statementId = await f.approvedStatementWith(period, [{ employee: f.employee, amounts }]);
  const response = await f.pay(period, markPaidInput({ paid_method: method }), `too-large-${method}`);
  expect([response.status, response.body['code']]).toEqual([422, 'COMMISSION_PAYABLE_TOO_LARGE']);
  expect((await statementRow(statementId))?.['status']).toBe('APPROVED');
  expect(await paymentRows(statementId)).toHaveLength(0);
  expect(await paidAudits(statementId)).toHaveLength(0);
});
