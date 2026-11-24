import {
  commissionClosedStatementBranchView,
  commissionClosedStatementView,
  markCommissionStatementPaidResponse,
  type MarkCommissionStatementPaidInput,
} from '@pospay/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { approveReviewedMonth, approverMember } from './approve-statement.fixture.ts';
import { estimateFixture } from './commission-estimate.fixture.ts';
import {
  memberWithGrants,
  PERIOD,
  READ,
  readStatement,
  statementPath,
  type StatementFixture,
} from './commission-statement.fixture.ts';
import { lockBarrier, type LockBarrier } from './statement-lock-barrier.fixture.ts';

// الصرف على شهر اتعمد بمسار الاعتماد الحقيقي (53-2) مش بصفوف مزروعة بإيد: المستحق في رد الصرف لازم يساوي
// المستحق في العرض المعتمد، والصلاحية بتتعاد تحت القفل وعلى الرد المخزّن وعلى تعارض المفتاح (CM-41، CM-42).
const PAY = 'pay:commissions:business';
const TIME_ZONE = 'Asia/Kuwait';

// الاعتماد بيكتب approved_at من ساعة قاعدة البيانات، فساعة الصرف بتتحرك بعده بدقيقة وتاريخ الصرف هو يوم الاعتماد.
let clockNow = new Date('2026-12-02T09:00:00Z');
let f: StatementFixture;
let approvedEmployees: { employee_id: string; payable: string }[];
let paidOn: string;
let barrier: LockBarrier;
let payer: { cookie: string; userId: string };
let winner: { key: string; body: ReturnType<typeof input> };

beforeAll(async () => {
  f = await estimateFixture({ commissionsClock: { now: () => clockNow } });
  const approver = await approverMember(f, 'flow-approver');
  const approval = await approveReviewedMonth(f, approver, 'flow-approve');
  expect(approval.response.status).toBe(200);
  approvedEmployees = (approval.response.body as { employees: typeof approvedEmployees }).employees;
  const [row] = await f.h.owner`SELECT approved_at FROM commission_statements
    WHERE company_id=${f.company} AND business_id=${f.business} AND period=${PERIOD}`;
  const approvedAt = row?.['approved_at'] as Date;
  clockNow = new Date(approvedAt.getTime() + 60_000);
  paidOn = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(approvedAt);
  barrier = lockBarrier(f.h.urls.owner, { company: f.company, business: f.business, period: PERIOD });
});
afterAll(async () => {
  await barrier?.end();
  await f?.h.close();
});

const input = (overrides: Partial<MarkCommissionStatementPaidInput> = {}) => ({
  paid_method: 'CASH' as const,
  paid_on: paidOn,
  ...overrides,
});

const pay = (cookie: string, key: string, body = input(), company = f.company) =>
  f.h.send('POST', statementPath(f.business, PERIOD, '/mark-paid'), { cookie, company, key, body });

const mills = (money: string): bigint => BigInt(money.replace('.', ''));

const footprint = async () => {
  const [row] = await f.h.owner`SELECT s.status,
      (SELECT count(*)::int FROM commission_statement_payments p WHERE p.statement_id = s.id) AS payments,
      (SELECT count(*)::int FROM audit_log WHERE entity_id = s.id AND action = 'commission_statement.paid') AS audits
    FROM commission_statements s
    WHERE s.company_id=${f.company} AND s.business_id=${f.business} AND s.period=${PERIOD}`;
  return row as { status: string; payments: number; audits: number };
};

it('refuses a branch grant of the pay permission, even one per branch, since payment is business-wide', async () => {
  const one = await memberWithGrants(f, 'pay-branch', [{ permission: PAY, scope: 'BRANCH' }]);
  const every = await memberWithGrants(f, 'pay-every-branch', [
    { permission: PAY, scope: 'BRANCH' },
    { permission: PAY, scope: 'SECOND_BRANCH' },
  ]);
  for (const [member, key] of [[one, 'branch-1'], [every, 'branch-2']] as const) {
    const response = await pay(member.cookie, key);
    expect([response.status, response.body['code']]).toEqual([403, 'FORBIDDEN']);
  }
  expect(await footprint()).toEqual({ status: 'APPROVED', payments: 0, audits: 0 });
});

// قرار 54-1-PAY-1 (وليد، 24 نوفمبر 2026): رد الصرف بيرجّع مستحق كل الموظفات، فالصلاحية من غير قراءة النشاط كله مرفوضة.
it('refuses the pay permission without business-wide read, even with a branch read', async () => {
  const noRead = await memberWithGrants(f, 'pay-no-read', [{ permission: PAY, scope: 'BUSINESS' }]);
  const branchRead = await memberWithGrants(f, 'pay-branch-read', [
    { permission: PAY, scope: 'BUSINESS' },
    { permission: READ, scope: 'BRANCH' },
  ]);
  for (const [member, key] of [[noRead, 'no-read-1'], [branchRead, 'no-read-2']] as const) {
    const response = await pay(member.cookie, key);
    expect([response.status, response.body['code']]).toEqual([403, 'FORBIDDEN']);
  }
  expect(await footprint()).toEqual({ status: 'APPROVED', payments: 0, audits: 0 });
});

it('refuses a caller from another company and writes nothing', async () => {
  const otherCookie = await f.h.signedInOperator('statement-pay-other-owner@example.test');
  const otherCompany = await f.h.onboard(otherCookie, 'Another employer');
  const response = await pay(otherCookie, 'other-tenant', input(), otherCompany);
  expect(response.status).toBeGreaterThanOrEqual(403);
  expect(response.status).toBeLessThanOrEqual(404);
  expect(await footprint()).toEqual({ status: 'APPROVED', payments: 0, audits: 0 });
});

it('two payers racing on one approved month: one pays, the other gets 409, and the payment is written once', async () => {
  payer = await memberWithGrants(f, 'payer', [
    { permission: PAY, scope: 'BUSINESS' },
    { permission: READ, scope: 'BUSINESS' },
  ]);
  const frozenBefore = await readStatement(f, f.cookie);
  const attempts = [
    { key: 'race-1', body: input() },
    { key: 'race-2', body: input({ paid_note: 'second payer' }) },
  ];
  // الحاجز بيثبت إن الطلبين وقفوا على قفل الشهر فعلاً قبل ما يتفرج عنه، فالتاني استنى الأول مش جه بعده.
  const responses = await barrier.whileHoldingLock(async (lock) => {
    const requests = attempts.map((a) => pay(payer.cookie, a.key, a.body));
    await barrier.waitForWaiters(2);
    lock.release();
    await lock.done;
    return barrier.collect(requests);
  });
  const won = responses.findIndex((response) => response.status === 200);
  expect(won).toBeGreaterThanOrEqual(0);
  winner = attempts[won] as typeof winner;
  const loser = responses[1 - won];
  expect([loser?.status, loser?.body['code']]).toEqual([409, 'COMMISSION_STATEMENT_ALREADY_PAID']);
  const body = markCommissionStatementPaidResponse.parse(responses[won]?.body);
  expect(body.paid_by).toBe(payer.userId);

  expect(await footprint()).toEqual({
    status: 'PAID',
    payments: approvedEmployees.length,
    audits: 1,
  });
  // المستحق في رد الصرف هو نفسه المستحق في العرض المعتمد لكل موظفة (قاعدة §9 مرة واحدة من المحرك)،
  // والكاش متقرّب لأقرب 5 فلوس ومجموع المصروف مجموع المبالغ المتصرفة.
  const approved = new Map(approvedEmployees.map((row) => [row.employee_id, row.payable]));
  expect(body.payments).toHaveLength(approved.size);
  for (const row of body.payments) {
    expect(row.exact_payable).toBe(approved.get(row.employee_id));
    const diff = mills(row.paid_amount) - mills(row.exact_payable);
    expect(mills(row.paid_amount) % 5n).toBe(0n);
    expect(diff >= -2n && diff <= 2n).toBe(true);
  }
  const total = body.payments.reduce((sum, row) => sum + mills(row.paid_amount), 0n);
  expect(mills(body.paid_total)).toBe(total);
  // العرض بعد الصرف هو نفس الكشف المجمّد بحالة PAID؛ الصرف ما غيّرش فيه شيء.
  const after = await readStatement(f, f.cookie);
  expect(after.status).toBe(200);
  expect((after.body as { status: string }).status).toBe('PAID');
  expect((after.body as { employees: unknown }).employees).toEqual(
    (frozenBefore.body as { employees: unknown }).employees,
  );
});

it('reads the paid month back with its payment: all of it to the business reader, only her employees to a branch reader (FR-037)', async () => {
  const business = commissionClosedStatementView.parse((await readStatement(f, f.cookie)).body);
  expect(business.status).toBe('PAID');
  expect(business.payment).toMatchObject({ paid_on: paidOn, paid_method: 'CASH', paid_by: payer.userId });
  const paidRows = business.payment?.payments ?? [];
  expect(paidRows.map((row) => row.employee_id).sort()).toEqual(approvedEmployees.map((row) => row.employee_id).sort());
  expect(mills(business.payment?.paid_total ?? '')).toBe(paidRows.reduce((sum, row) => sum + mills(row.paid_amount), 0n));

  const branch = commissionClosedStatementBranchView.parse((await readStatement(f, f.branchCookie)).body);
  expect(Object.keys(branch.payment ?? {}).sort()).toEqual(['paid_method', 'paid_on', 'payments']);
  expect(branch.payment?.payments.map((row) => row.employee_id).sort()).toEqual(
    branch.employees.map((employee) => employee.employee_id).sort(),
  );
  expect(branch.payment?.payments.length).toBeLessThanOrEqual(paidRows.length);
});

it('a payer whose permission is withdrawn after paying is refused at the guard on a replay, a reused key and a new key', async () => {
  await f.h.owner`DELETE FROM role_permissions WHERE company_id=${f.company} AND permission_code=${PAY}
    AND role_id IN (SELECT role_id FROM memberships WHERE company_id=${f.company} AND user_id=${payer.userId})`;

  const replay = await pay(payer.cookie, winner.key, winner.body);
  const reused = await pay(payer.cookie, winner.key, { ...winner.body, paid_note: 'another body' });
  const fresh = await pay(payer.cookie, 'withdrawn-new-key');
  for (const response of [replay, reused, fresh]) {
    expect([response.status, response.body['code']]).toEqual([403, 'FORBIDDEN']);
  }
  expect(await footprint()).toMatchObject({ status: 'PAID', audits: 1 });
});
