import { createDatabase, type ClaimedEvent, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

import {
  COMMISSION_LINE_IDS,
  COMMISSION_LINE_TENANTS,
  seedCommissionLineTenants,
} from '../../../../../../packages/db/test/commission-line-fixtures.ts';
import { walkCommissionStatement } from '../../../../../../packages/db/test/commission-statement-fixtures.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../packages/db/test/test-database.ts';
import { createTestCommissionInputsConsumer } from '../../../__tests__/commission-inputs-consumer.ts';
import { createDeliverer } from '../../../outbox/deliver.ts';
import { fakeBusinessTimeZone } from './commission-line-projection-time-zone.ts';
import {
  commissionSalaryEvent,
  commissionTipEvent,
} from './commission-tip-salary-events.ts';

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
  await owner`DELETE FROM commission_tips`;
  await owner`DELETE FROM commission_tip_heads`;
  await owner`DELETE FROM commission_salaries`;
  await owner`DELETE FROM commission_statements`;
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

  const [head] = await owner`SELECT revision FROM commission_tip_heads WHERE session_id=${sessionId}::uuid`;
  expect(head?.revision).toBe(3);
  const storedTips = await owner`SELECT employee_id, method, amount::text AS amount
    FROM commission_tips WHERE session_id=${sessionId}::uuid`;
  expect(storedTips).toMatchObject([
    { employee_id: COMMISSION_LINE_IDS.secondEmployee, method: 'CARD', amount: '30.000' },
  ]);
  const marks = await owner`SELECT event_id FROM consumed_events WHERE consumer_id='commissions.project-inputs'`;
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
  const marks = await owner`SELECT event_id FROM consumed_events WHERE consumer_id='commissions.project-inputs'`;
  expect(marks).toHaveLength(2);
}, 30_000);

it('two different-date salary events of one employee delivered concurrently both land and reopen shrunken range', async () => {
  const employeeLockKey = `${A.company}:commission-salary-employee:${A.employee}`;

  for (const period of ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08']) {
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

  const marks = await owner`SELECT event_id FROM consumed_events WHERE consumer_id='commissions.project-inputs'`;
  expect(marks).toHaveLength(2);
}, 30_000);
