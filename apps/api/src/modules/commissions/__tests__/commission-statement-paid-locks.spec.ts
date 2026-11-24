import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  markPaidInput,
  payerMember,
  statementPayFixture,
  withdrawPay,
  type StatementPayFixture,
} from './commission-statement-paid.fixture.ts';
import { lockBarrier, type LockBarrier } from './statement-lock-barrier.fixture.ts';

// التزامن على قفل الشهر (54-1): الحاجز بيمسك قفل صف الكشف من اتصال مستقل، فكل طلب بيبدأ فعلاً وبيقف على القفل أو على
// مطالبة المفتاح قبل ما نتصرف في الصلاحية أو الساعة. ساعة الصرف حقيقية هنا لأن وقت التسجيل من ساعة قاعدة البيانات.
const TIME_ZONE = 'Asia/Kuwait';
const TEST_TIMEOUT_MS = 120_000;

let f: StatementPayFixture;
const barriers: LockBarrier[] = [];

beforeAll(async () => {
  f = await statementPayFixture(() => new Date());
});
afterAll(async () => {
  await Promise.all(barriers.map((barrier) => barrier.end()));
  await f?.close();
});

const barrierFor = (period: string): LockBarrier => {
  const barrier = lockBarrier(f.h.urls.owner, { company: f.company, business: f.business, period });
  barriers.push(barrier);
  return barrier;
};

const kuwaitToday = (): string => new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date());

const footprint = async (period: string) => {
  const [row] = await f.h.owner`SELECT s.status,
      (SELECT count(*)::int FROM commission_statement_payments p WHERE p.statement_id = s.id) AS payments,
      (SELECT count(*)::int FROM audit_log WHERE entity_id = s.id AND action = 'commission_statement.paid') AS audits
    FROM commission_statements s
    WHERE s.company_id=${f.company} AND s.business_id=${f.business} AND s.period=${period}`;
  return row as { status: string; payments: number; audits: number };
};

it('two payers waiting on the month lock: one pays, the other gets 409, and paid_at is not before an approval stamped while they waited', async () => {
  const period = '2027-01';
  const statementId = await f.approvedStatementWithCommission(period);
  const barrier = barrierFor(period);
  const paidOn = kuwaitToday();

  const responses = await barrier.whileHoldingLock(
    async (lock) => {
      const requests = [
        f.pay(period, markPaidInput({ paid_on: paidOn }), 'lock-1'),
        f.pay(period, markPaidInput({ paid_on: paidOn, paid_note: 'second payer' }), 'lock-2'),
      ];
      await barrier.waitForWaiters(2);
      lock.release();
      await lock.done;
      return barrier.collect(requests);
    },
    // الاعتماد اللي بدأ بعد الطلبين بيتحاكى بتأخير approved_at لحظة الإفراج (وضع replica للمالك بس).
    async (tx) => {
      await tx`SET LOCAL session_replication_role = replica`;
      await tx`UPDATE commission_statements SET approved_at = clock_timestamp()
        WHERE company_id = ${f.company} AND id = ${statementId}`;
    },
  );

  const outcomes = responses.map((response) => [response.status, response.body['code'] ?? null]);
  expect(outcomes.filter(([status]) => status === 200)).toHaveLength(1);
  expect(outcomes.filter(([status, code]) => status === 409 && code === 'COMMISSION_STATEMENT_ALREADY_PAID')).toHaveLength(1);
  expect(await footprint(period)).toEqual({ status: 'PAID', payments: 1, audits: 1 });
  const [times] = await f.h.owner`SELECT paid_at >= approved_at AS ordered FROM commission_statements
    WHERE company_id=${f.company} AND id=${statementId}`;
  expect(times?.['ordered']).toBe(true);
}, TEST_TIMEOUT_MS);

it('a permission withdrawn while the request waits on the month lock is refused by the recheck under the lock', async () => {
  const period = '2027-02';
  await f.approvedStatementWithCommission(period);
  const payer = await payerMember(f, 'waiting');
  const barrier = barrierFor(period);

  const [response] = await barrier.whileHoldingLock(async (lock) => {
    const request = f.pay(period, markPaidInput(), 'withdrawn-while-waiting', payer.cookie);
    await barrier.waitForWaiters(1);
    await withdrawPay(f, payer.role);
    lock.release();
    await lock.done;
    return barrier.collect([request]);
  });

  expect([response?.status, response?.body['code']]).toEqual([403, 'FORBIDDEN']);
  expect(await footprint(period)).toEqual({ status: 'APPROVED', payments: 0, audits: 0 });
}, TEST_TIMEOUT_MS);

it('callers who wait on the first claim of a key and lose their permission get 403, not the stored replay or the key-reuse 422', async () => {
  const period = '2027-03';
  await f.approvedStatementWithCommission(period);
  const [first, replayer, reuser] = await Promise.all([
    payerMember(f, 'first'),
    payerMember(f, 'replayer'),
    payerMember(f, 'reuser'),
  ]);
  const barrier = barrierFor(period);
  const body = markPaidInput();

  const responses = await barrier.whileHoldingLock(async (lock) => {
    const claimant = f.pay(period, body, 'shared-key', first.cookie);
    await barrier.waitForWaiters(1);
    const waiters = [
      f.pay(period, body, 'shared-key', replayer.cookie),
      f.pay(period, markPaidInput({ paid_note: 'another body' }), 'shared-key', reuser.cookie),
    ];
    await barrier.waitForWaiters(3);
    await withdrawPay(f, replayer.role);
    await withdrawPay(f, reuser.role);
    lock.release();
    await lock.done;
    return barrier.collect([claimant, ...waiters]);
  });

  expect(responses.map((response) => response.status)).toEqual([200, 403, 403]);
  expect(responses.slice(1).map((response) => response.body['code'])).toEqual(['FORBIDDEN', 'FORBIDDEN']);
  expect(await footprint(period)).toEqual({ status: 'PAID', payments: 1, audits: 1 });
}, TEST_TIMEOUT_MS);
