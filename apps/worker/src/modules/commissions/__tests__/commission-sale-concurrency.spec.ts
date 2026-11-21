import { createDatabase, type ClaimedEvent, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

import {
  COMMISSION_LINE_TENANTS,
  seedCommissionLineTenants,
} from '../../../../../../packages/db/test/commission-line-fixtures.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../packages/db/test/test-database.ts';
import { createTestCommissionInputsConsumer } from '../../../__tests__/commission-inputs-consumer.ts';
import { commissionSaleEvent } from './commission-tip-salary-events.ts';
import { createDeliverer } from '../../../outbox/deliver.ts';
import { fakeBusinessTimeZone } from './commission-line-projection-time-zone.ts';

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
const SALE = '01970000-0000-7000-8000-000000000001';

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
  await owner`DELETE FROM commission_sales`;
  await owner`DELETE FROM commission_statements`;
  await owner`DELETE FROM consumed_events WHERE consumer_id='commissions.project-inputs'`;
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

const saleRow = () =>
  owner`SELECT refunded_amount::text AS "refundedAmount",revision
    FROM commission_sales WHERE company_id=${A.company} AND sale_id=${SALE}`;

it('a replayed revision 1 and a live revision 2 race on one identity and the newer stands (CM-22b)', async () => {
  const saleLockKey = `${A.company}:commission-sale:${SALE}`;
  const revision1 = commissionSaleEvent(A, ids, { saleId: SALE });
  const revision2 = commissionSaleEvent(A, ids, {
    saleId: SALE,
    revision: 2,
    refundedAmount: '10.000',
  });

  const lock = await holdLock(saleLockKey);
  const deliveries = [deliver(revision1), deliver(revision2)];
  const waiting = await pollWhileLocked(lock, [saleLockKey]);
  await lock.finished;
  await Promise.all(deliveries);

  expect(waiting).toBeGreaterThanOrEqual(2);
  const rows = await saleRow();
  expect(rows).toEqual([{ refundedAmount: '10.000', revision: 2 }]);
});

it('any permutation of a fixed event set converges to the same row (CM-21)', async () => {
  const revision1 = commissionSaleEvent(A, ids, { saleId: SALE });
  const revision2 = commissionSaleEvent(A, ids, {
    saleId: SALE,
    revision: 2,
    refundedAmount: '5.000',
  });
  const revision3 = commissionSaleEvent(A, ids, {
    saleId: SALE,
    revision: 3,
    refundedAmount: '20.000',
  });
  const revision4 = commissionSaleEvent(A, ids, {
    saleId: SALE,
    revision: 4,
    refundedAmount: '30.000',
  });
  const permutations = [
    [revision1, revision2, revision3, revision4],
    [revision4, revision3, revision2, revision1],
    [revision2, revision4, revision1, revision3],
    [revision3, revision1, revision4, revision2],
    [revision2, revision1, revision3, revision4],
    [revision1, revision1, revision3, revision4, revision3],
  ];
  for (const permutation of permutations) {
    await owner`DELETE FROM commission_sales`;
    await owner`DELETE FROM consumed_events WHERE consumer_id='commissions.project-inputs'`;
    for (const event of permutation) {
      await deliver({ ...event, id: ids.newId() });
    }
    const rows = await saleRow();
    expect(rows).toEqual([{ refundedAmount: '30.000', revision: 4 }]);
  }
});
