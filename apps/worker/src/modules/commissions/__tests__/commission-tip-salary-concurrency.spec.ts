import { createDatabase, lockStatementPeriods, type ClaimedEvent, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

import {
  COMMISSION_LINE_IDS,
  COMMISSION_LINE_TENANTS,
  insertCommissionLineProjection,
  seedCommissionLineTenants,
} from '../../../../../../packages/db/test/commission-line-fixtures.ts';
import { insertCommissionPlanVersion } from '../../../../../../packages/db/test/commission-plan-version-fixtures.ts';
import {
  FINGERPRINTS,
  insertCommissionAttachment,
  insertCommissionLine,
  walkCommissionStatement,
} from '../../../../../../packages/db/test/commission-statement-fixtures.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../packages/db/test/test-database.ts';
import { USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { createTestCommissionInputsConsumer } from '../../../__tests__/commission-inputs-consumer.ts';
import { createDeliverer } from '../../../outbox/deliver.ts';
import { fakeBusinessTimeZone } from './commission-line-projection-time-zone.ts';
import { commissionSalaryEvent, commissionTipEvent } from './commission-tip-salary-events.ts';

let testDb: TestDatabase;
let owner: postgres.Sql;
let locker: postgres.Sql;
let db: Database;
let deliver: (event: ClaimedEvent) => Promise<unknown>;
const ids = systemUuidV7();
const { A } = COMMISSION_LINE_TENANTS;
const clock = { now: () => new Date('2026-12-05T09:00:00Z') };
const POLL_INTERVAL_MS = 25;
const POLL_LIMIT_MS = 5_000;
// خطة المثال المحسوب وصفوف بنوده؛ نفس الأرقام التي أثبتها اختبار D10 الصافي.
const SALARY_LINE_L1 = '01920000-0000-7000-8000-00000000d511';
const SALARY_LINE_L2 = '01920000-0000-7000-8000-00000000d512';
const SALARY_THRESHOLD_PLAN = {
  base: { enabled: false },
  tiers: {
    enabled: true,
    accumulator: 'AMOUNT',
    mode: 'MARGINAL',
    steps: [{ from: { kind: 'SALARY_MULTIPLE', value: '1.00' }, calc: { kind: 'PCT', bps: 1000 } }],
  },
  package_sale: { enabled: false },
} as const;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedCommissionLineTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  locker = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids });
  const consumer = createTestCommissionInputsConsumer({
    ids,
    clock,
    businessTimeZone: fakeBusinessTimeZone(A.business),
  });
  deliver = createDeliverer(db, [consumer], createLogger('silent'), {
    knownEventTypes: consumer.eventTypes,
  });
});

afterAll(async () => {
  await db?.close();
  await locker?.end();
  await owner?.end();
  await testDb?.drop();
});

beforeEach(async () => {
  await owner`DELETE FROM commission_corrections`;
  await owner`DELETE FROM commission_period_generations`;
  await owner`DELETE FROM commission_statement_attachments`;
  await owner`DELETE FROM commission_statement_lines`;
  await owner`DELETE FROM commission_tips`;
  await owner`DELETE FROM commission_tip_heads`;
  await owner`DELETE FROM commission_salaries`;
  await owner`DELETE FROM commission_statements`;
  await owner`DELETE FROM commission_plan_versions`;
  await owner`DELETE FROM commission_lines`;
  await owner`DELETE FROM commission_line_heads`;
  await owner`DELETE FROM consumed_events WHERE consumer_id='commissions.project-inputs'`;
  await owner`UPDATE businesses SET created_at = '2025-01-01T00:00:00Z' WHERE company_id = ${A.company} AND id = ${A.business}`;
});

interface HeldLock {
  readonly release: () => void;
  readonly finished: Promise<void>;
}

async function holdLock(lockKey: string): Promise<HeldLock> {
  let signalAcquired = (): void => undefined;
  let signalRelease = (): void => undefined;
  const acquired = new Promise<void>((resolve) => {
    signalAcquired = () => resolve(undefined);
  });
  const released = new Promise<void>((resolve) => {
    signalRelease = () => resolve(undefined);
  });
  const finished = locker.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
    signalAcquired();
    await released;
  });
  await Promise.race([
    acquired,
    finished.then(() => {
      throw new Error('the owner transaction ended before it held the lock');
    }),
  ]);
  return { release: signalRelease, finished };
}

async function countWaitingAdvisoryLocks(lockKeys: readonly string[]): Promise<number> {
  const [row] = await owner<{ waiting: number }[]>`
    WITH identity AS (
      SELECT hashtextextended(k, 0) AS key FROM unnest(${lockKeys}::text[]) AS k
    )
    SELECT count(*)::int AS waiting
    FROM pg_locks
    WHERE locktype = 'advisory'
      AND objsubid = 1
      AND NOT granted
      AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
      AND classid::bigint::numeric * 4294967296 + objid::bigint::numeric
          IN (SELECT CASE WHEN key >= 0 THEN key::numeric ELSE key::numeric + 18446744073709551616 END FROM identity)`;
  return row?.waiting ?? 0;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(() => resolve(), ms);
  });

async function pollWhileLocked(lock: HeldLock, lockKeys: readonly string[]): Promise<number> {
  try {
    const deadline = Date.now() + POLL_LIMIT_MS;
    let waiting = 0;
    while (Date.now() < deadline) {
      waiting = await countWaitingAdvisoryLocks(lockKeys);
      if (waiting >= 2) return waiting;
      await sleep(POLL_INTERVAL_MS);
    }
    return waiting;
  } finally {
    lock.release();
  }
}

it('same-session revisions 2 and 3 delivered concurrently converge to rev 3', async () => {
  const sessionId = ids.newId();
  const sessionLockKey = `${A.company}:commission-tip-session:${sessionId}`;
  const rev2 = commissionTipEvent(A, ids, {
    sessionId,
    revision: 2,
    tips: [{ employee_id: A.employee, method: 'CASH', amount: '20.000' }],
  });
  const rev3 = commissionTipEvent(A, ids, {
    sessionId,
    revision: 3,
    tips: [{ employee_id: COMMISSION_LINE_IDS.secondEmployee, method: 'CARD', amount: '30.000' }],
  });

  const lock = await holdLock(sessionLockKey);
  const deliveries = [deliver(rev2), deliver(rev3)];
  const waiting = await pollWhileLocked(lock, [sessionLockKey]);
  await lock.finished;
  const outcomes = await Promise.all(deliveries);

  expect(waiting).toBeGreaterThanOrEqual(2);
  expect(outcomes).toEqual([{ delivered: true }, { delivered: true }]);

  const [head] =
    await owner`SELECT revision FROM commission_tip_heads WHERE session_id=${sessionId}::uuid`;
  expect(head?.revision).toBe(3);
  const storedTips = await owner`SELECT employee_id, method, amount::text AS amount
    FROM commission_tips WHERE session_id=${sessionId}::uuid`;
  expect(storedTips).toMatchObject([
    { employee_id: COMMISSION_LINE_IDS.secondEmployee, method: 'CARD', amount: '30.000' },
  ]);
  const marks =
    await owner`SELECT event_id FROM consumed_events WHERE consumer_id='commissions.project-inputs'`;
  expect(marks).toHaveLength(2);
}, 30_000);

it('same-date salary revisions converge to the higher revision', async () => {
  const effectiveFrom = '2026-05-01';
  const salaryLockKey = `${A.company}:commission-salary:${A.employee}:${effectiveFrom}`;
  const employeeLockKey = `${A.company}:commission-salary-employee:${A.employee}`;
  const rev2 = commissionSalaryEvent(A, ids, {
    effectiveFrom,
    amount: '550.000',
    revision: 2,
  });
  const rev3 = commissionSalaryEvent(A, ids, {
    effectiveFrom,
    amount: '650.000',
    revision: 3,
  });

  const lock = await holdLock(salaryLockKey);
  const deliveries = [deliver(rev2), deliver(rev3)];
  const waiting = await pollWhileLocked(lock, [salaryLockKey, employeeLockKey]);
  await lock.finished;
  const outcomes = await Promise.all(deliveries);

  expect(waiting).toBeGreaterThanOrEqual(2);
  expect(outcomes).toEqual([{ delivered: true }, { delivered: true }]);

  const [row] = await owner`SELECT revision, amount::text AS amount
    FROM commission_salaries WHERE employee_id=${A.employee}::uuid AND effective_from=${effectiveFrom}::date`;
  expect(row).toMatchObject({ revision: 3, amount: '650.000' });
  const marks =
    await owner`SELECT event_id FROM consumed_events WHERE consumer_id='commissions.project-inputs'`;
  expect(marks).toHaveLength(2);
}, 30_000);

it('two different-date salary events of one employee delivered concurrently both land and reopen shrunken range', async () => {
  const employeeLockKey = `${A.company}:commission-salary-employee:${A.employee}`;

  for (const period of [
    '2026-02',
    '2026-03',
    '2026-04',
    '2026-05',
    '2026-06',
    '2026-07',
    '2026-08',
  ]) {
    await walkCommissionStatement(db, { tenant: A, period, ids, to: 'REVIEWED' });
  }

  const eventApril = commissionSalaryEvent(A, ids, {
    effectiveFrom: '2026-04-01',
    amount: '500.000',
    revision: 1,
  });
  const eventJuly = commissionSalaryEvent(A, ids, {
    effectiveFrom: '2026-07-01',
    amount: '700.000',
    revision: 1,
  });

  const lock = await holdLock(employeeLockKey);
  const deliveries = [deliver(eventApril), deliver(eventJuly)];
  const waiting = await pollWhileLocked(lock, [employeeLockKey]);
  await lock.finished;
  const outcomes = await Promise.all(deliveries);

  expect(waiting).toBeGreaterThanOrEqual(2);
  expect(outcomes).toEqual([{ delivered: true }, { delivered: true }]);

  const rows = await owner`SELECT effective_from::text AS "effectiveFrom", amount::text AS amount
    FROM commission_salaries WHERE employee_id=${A.employee}::uuid ORDER BY effective_from`;
  expect(rows).toMatchObject([
    { effectiveFrom: '2026-04-01', amount: '500.000' },
    { effectiveFrom: '2026-07-01', amount: '700.000' },
  ]);

  const statements = await owner`SELECT period, status FROM commission_statements
    WHERE company_id=${A.company} AND business_id=${A.business}
      AND period BETWEEN '2026-02' AND '2026-08' ORDER BY period`;
  expect(statements).toEqual([
    { period: '2026-02', status: 'REVIEWED' },
    { period: '2026-03', status: 'REVIEWED' },
    { period: '2026-04', status: 'DRAFT' },
    { period: '2026-05', status: 'DRAFT' },
    { period: '2026-06', status: 'DRAFT' },
    { period: '2026-07', status: 'DRAFT' },
    { period: '2026-08', status: 'DRAFT' },
  ]);

  const marks =
    await owner`SELECT event_id FROM consumed_events WHERE consumer_id='commissions.project-inputs'`;
  expect(marks).toHaveLength(2);
}, 30_000);

/**
 * ينتظر حتى يظهر منتظر على قفل صف كشف؛ العائق يضمن أن المستهلك وصل إلى الانتظار فعلاً.
 * الحصر بقاعدة الاختبار بيجي من pg_stat_activity مش من pg_locks.database: أقفال transactionid
 * بتتسجل بـ database NULL، ففلتر الداتابيز على pg_locks كان هيصفّيها كلها. واستبعاد دور
 * المراقبة (owner) بيمنع أي عميل غريب أو مواصفة توازية على نفس الكلاستر إنه يفتح العائق
 * قبل وصول المستهلك الحقيقي؛ معاملة العائق ماسكة الأقفال ومش مستنية، فلا تُحسب أصلاً.
 */
async function waitForStatementLockWaiter(): Promise<void> {
  const deadline = Date.now() + POLL_LIMIT_MS;
  while (Date.now() < deadline) {
    const [row] = await owner<{ waiting: number }[]>`
      SELECT count(*)::int AS waiting FROM pg_locks l
      JOIN pg_stat_activity a ON a.pid = l.pid
      WHERE NOT l.granted AND l.locktype IN ('transactionid', 'tuple')
        AND a.datname = current_database()
        AND a.usename <> current_user`;
    if ((row?.waiting ?? 0) >= 1) return;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error('the consumer never waited on the held statement lock');
}

/** يذرع شهر سبتمبر من المثال المحسوب: بنودا L1 وL2 وخطة الراتب وراتب 500.000 ثم REVIEWED. */
async function seedSalaryWorkedSeptember(): Promise<void> {
  await db.withTenant(A.company, async (tx) => {
    await insertCommissionLineProjection(tx, A, ids, {
      lineId: SALARY_LINE_L1,
      businessDate: '2026-09-10',
      occurredAt: '2026-09-10T09:00:00Z',
      recordedAt: '2026-09-10T09:00:00Z',
      period: '2026-09',
      net: '400.000',
      ruleKind: 'FOLLOW_PLAN',
    });
    await insertCommissionLineProjection(tx, A, ids, {
      lineId: SALARY_LINE_L2,
      businessDate: '2026-09-20',
      occurredAt: '2026-09-20T09:00:00Z',
      recordedAt: '2026-09-20T09:00:00Z',
      period: '2026-09',
      net: '300.000',
      ruleKind: 'FOLLOW_PLAN',
    });
    await insertCommissionPlanVersion(tx, A, ids, {
      employeeId: A.employee,
      effectiveFrom: '2025-06-01',
      plan: SALARY_THRESHOLD_PLAN,
    });
  });
  await owner`INSERT INTO commission_salaries(
    company_id,id,business_id,employee_id,effective_from,amount,revision)
    VALUES(${A.company},${ids.newId()},${A.business},${A.employee},'2026-09-01'::date,'500.000',1)`;
  await walkCommissionStatement(db, { tenant: A, period: '2026-09', ids, to: 'REVIEWED' });
}

/** معاملة الاعتماد المعيقة: تحمل قفل سبتمبر ثم توافق وتجمّد L2 عند فك العائق. */
function startApprovalBehindBarrier(): {
  seed: Promise<void>;
  releaseSeed: () => void;
  seedHeld: Promise<void>;
} {
  let releaseSeed: () => void = () => undefined;
  const seedBarrier = new Promise<void>((resolve) => {
    releaseSeed = resolve;
  });
  let signalSeedLocked: () => void = () => undefined;
  const seedHeld = new Promise<void>((resolve) => {
    signalSeedLocked = resolve;
  });
  const seed = db.withTenant(A.company, async (tx) => {
    const [statement] = await lockStatementPeriods(tx, {
      businessId: A.business,
      periods: ['2026-09'],
      ids,
    });
    signalSeedLocked();
    await seedBarrier;
    await tx.execute(sql`UPDATE commission_statements
      SET status='APPROVED', approved_by=${USER}, approved_at='2026-11-02T08:00:00Z',
        input_fingerprint=${FINGERPRINTS.input}, statement_fingerprint=${FINGERPRINTS.statement}
      WHERE company_id=${A.company} AND id=${statement?.statementId}::uuid`);
    await insertCommissionLine(tx, A, statement?.statementId ?? '', ids, {
      kind: 'COMMISSION',
      lineId: SALARY_LINE_L2,
      sessionId: COMMISSION_LINE_IDS.sessionA,
      serviceId: A.service,
      customerId: A.customer,
      sourceRef: `line:${SALARY_LINE_L2}`,
      amount: '20.000',
      sourceBranchId: A.branch,
      sourceBusinessDate: '2026-09-20',
      businessDate: '2026-09-20',
      attachedBranchIds: [A.branch],
    });
    await insertCommissionAttachment(tx, A, statement?.statementId ?? '', ids, {
      employeeId: A.employee,
    });
  });
  return { seed, releaseSeed, seedHeld };
}

it('C1 (CM-48c shape, salary) the consumer waits for the in-flight approval and posts into October', async () => {
  await seedSalaryWorkedSeptember();
  const { seed, releaseSeed, seedHeld } = startApprovalBehindBarrier();
  await seedHeld;

  const event = commissionSalaryEvent(A, ids, {
    effectiveFrom: '2026-09-01',
    amount: '550.000',
    revision: 2,
  });
  const delivery = deliver(event);
  // لو الانتظار فشل لازم العائق يتحرر برضه، وإلا معاملة الاعتماد تفضل متجمدة ماسكة اتصال
  // وأقفال الكشف، والفشل الحقيقي يغرق في ضجيج teardown. الوعدَين بيتسوّوا بـ allSettled قبل الرمي.
  let waiterError: unknown;
  try {
    await waitForStatementLockWaiter();
  } catch (error) {
    waiterError = error;
  } finally {
    releaseSeed();
  }
  const [seedOutcome, deliveryOutcome] = await Promise.allSettled([seed, delivery]);
  if (waiterError !== undefined) throw waiterError;
  // رفض seed أو delivery كان سينتشر عبر Promise.all قبل التعديل؛ بنعيد إثباته صراحة بعد allSettled.
  if (seedOutcome.status === 'rejected') throw seedOutcome.reason;
  if (deliveryOutcome.status === 'rejected') throw deliveryOutcome.reason;

  const [september] = await owner`SELECT status FROM commission_statements
    WHERE company_id=${A.company} AND period='2026-09'`;
  expect(september?.status).toBe('APPROVED');
  const rows = await owner`SELECT source_period, target_period, source_ref, kind,
    amount::text AS amount, previous_amount::text AS previous_amount,
    new_amount::text AS new_amount, generation
    FROM commission_corrections ORDER BY source_period`;
  expect(rows).toMatchObject([
    {
      source_period: '2026-09',
      target_period: '2026-10',
      source_ref: `line:${SALARY_LINE_L2}`,
      kind: 'COMMISSION',
      amount: '-5.000',
      previous_amount: '20.000',
      new_amount: '15.000',
      generation: 1,
    },
  ]);
  const marks =
    await owner`SELECT event_id FROM consumed_events WHERE consumer_id='commissions.project-inputs'`;
  expect(marks).toHaveLength(1);
}, 30_000);
