import { createDatabase, type ClaimedEvent, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

import {
  COMMISSION_LINE_IDS,
  COMMISSION_LINE_TENANTS,
  commissionLineEvent,
  seedCommissionLineTenants,
} from '../../../../../../packages/db/test/commission-line-fixtures.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../packages/db/test/test-database.ts';
import { createTestCommissionInputsConsumer } from '../../../__tests__/commission-inputs-consumer.ts';
import { createDeliverer } from '../../../outbox/deliver.ts';
import { fakeBusinessTimeZone } from './commission-line-projection-time-zone.ts';

let testDb: TestDatabase;
let owner: postgres.Sql;
let locker: postgres.Sql;
let db: Database;
let deliver: (event: ClaimedEvent) => Promise<unknown>;
const ids = systemUuidV7();
const { A } = COMMISSION_LINE_TENANTS;
const businessTimeZone = fakeBusinessTimeZone(A.business);
const clock = { now: () => new Date('2026-12-05T09:00:00Z') };
const POLL_INTERVAL_MS = 25;
const POLL_LIMIT_MS = 5_000;
// النص اللي بيتحجّز عليه قفل هوية البند: نفس نص المحول بالظبط
// (app_company_id()::text || ':commission-line:' || <lineId>::uuid::text)،
// مكان واحد للحاجز والاستطلاع، فمقدرش يختلفوا من غير ما الاختبار يقع.
const IDENTITY_LOCK_KEY = `${A.company}:commission-line:${COMMISSION_LINE_IDS.lineA}`;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedCommissionLineTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  // اتصال منفصل للقفل: لازم يفضل حر من غير ما ياخد connection التنضيف اللي بيستعمله الـ polling.
  locker = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids });
  const consumer = createTestCommissionInputsConsumer({ ids, clock, businessTimeZone });
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
  await owner`DELETE FROM commission_lines`;
  await owner`DELETE FROM commission_line_heads`;
  await owner`DELETE FROM consumed_events WHERE consumer_id='commissions.project-inputs'`;
});

const event = (
  type: 'ServiceSessionRecorded' | 'ServiceSessionLinesAdded' | 'ServiceLineChanged',
  row: Record<string, unknown> = {},
) => commissionLineEvent(A, ids, type, row);
const heads = () => owner`SELECT * FROM commission_line_heads ORDER BY line_id`;
const lines = () => owner`SELECT * FROM commission_lines ORDER BY line_id,employee_id`;
const marks = () => owner`SELECT event_id FROM consumed_events WHERE consumer_id='commissions.project-inputs'`;

interface HeldIdentityLock {
  readonly release: () => void;
  readonly finished: Promise<void>;
}

/**
 * يفتح معاملة على اتصال مستقل وتحجز قفل هوية البند نفسه اللي بيحجزه المحول.
 * القفل ما بيتفكش غير لما الاختبار يسمّي release، عشان التسليمين يتزاحموا عليه فعلاً.
 */
async function holdIdentityLock(): Promise<HeldIdentityLock> {
  let signalAcquired = (): void => undefined;
  let signalRelease = (): void => undefined;
  const acquired = new Promise<void>((resolve) => {
    signalAcquired = () => resolve(undefined);
  });
  const released = new Promise<void>((resolve) => {
    signalRelease = () => resolve(undefined);
  });
  const finished = locker.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${IDENTITY_LOCK_KEY}, 0))`;
    signalAcquired();
    await released;
  });
  await Promise.race([
    acquired,
    finished.then(() => {
      throw new Error('the owner transaction ended before it held the identity lock');
    }),
  ]);
  return { release: signalRelease, finished };
}

/** بيعدّ الأقفال الاستشارية المعلّقة على قفل هوية البند ده في داتابيز الاختبار — صفر لو مفيش تسليمة واقفة. */
async function countWaitingAdvisoryLocks(): Promise<number> {
  // pg_locks بيشوف السيرفر كله، فلازم نقصر العدّ على داتابيز الاختبار وعلى المفتاح بتاعنا بالظبط:
  // database هي OID الداتابيز اللي القفل اتحجّز فيه، وclassid وobjid هما نصفي المفتاح
  // (32 بت عالي و32 بت واطي) بتوع صيغة bigint، وobjsubid = 1 هي صيغة الـ bigint نفسها.
  // والمفتاح اللي hashtextextended بيرجّعه signed، فبنقارنه بالشكل غير الموقع (64 بت)
  // عشان المطابقة تبقى صح سواء كان سالب أو موجب.
  // والـ oid مافيهوش cast مباشر لـ numeric، فنمرّيه على bigint الأول (قيمته 0..2^32-1).
  const [row] = await owner<{ waiting: number }[]>`
    WITH identity AS (SELECT hashtextextended(${IDENTITY_LOCK_KEY}, 0) AS key)
    SELECT count(*)::int AS waiting
    FROM pg_locks
    WHERE locktype = 'advisory'
      AND objsubid = 1
      AND NOT granted
      AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
      AND classid::bigint::numeric * 4294967296 + objid::bigint::numeric
          = (SELECT CASE WHEN key >= 0 THEN key::numeric ELSE key::numeric + 18446744073709551616 END FROM identity)`;
  return row?.waiting ?? 0;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(() => resolve(), ms);
  });

/** بينتظر لحد ما التسليمين الاتنين يبقوا واقعين على قفل الهوية، أو لحد ما الوقت يخلص. */
async function waitForWaitingLocks(expected: number): Promise<number> {
  const deadline = Date.now() + POLL_LIMIT_MS;
  let waiting = 0;
  while (Date.now() < deadline) {
    waiting = await countWaitingAdvisoryLocks();
    if (waiting >= expected) return waiting;
    await sleep(POLL_INTERVAL_MS);
  }
  return waiting;
}

/** بينتظر على الأقفال المعلّقة ويفك قفل الهوية في كل الأحوال، حتى لو الوقت خلص من غير نتيجة. */
async function pollWhileLocked(lock: HeldIdentityLock): Promise<number> {
  try {
    return await waitForWaitingLocks(2);
  } finally {
    lock.release();
  }
}

it('two revisions of a new line held behind its identity lock converge on revision 2', async () => {
  const changed = event('ServiceLineChanged', {
    revision: 2,
    net: '20.000',
    previousNet: '10.001',
    changeKind: 'PRICE_DISCOUNT_EDIT',
  });
  const recorded = event('ServiceSessionRecorded', { net: '10.001' });

  const lock = await holdIdentityLock();
  const deliveries = [deliver(changed), deliver(recorded)];
  // الانتظار على أقفال pg_locks هو اللي بيثبت إن التسليمين اتزاحموا على قفل الهوية قبل ما يتفك؛
  // من غيره الاختبار ممكن يمرّ من غير ما الحاجز يشتغل أصلاً.
  const waiting = await pollWhileLocked(lock);
  await lock.finished;
  const outcomes = await Promise.all(deliveries);

  expect(
    waiting,
    'both deliveries must wait on the line identity lock before it is released',
  ).toBeGreaterThanOrEqual(2);
  expect(outcomes).toEqual([{ delivered: true }, { delivered: true }]);

  const storedHeads = await heads();
  expect(storedHeads).toHaveLength(1);
  expect(storedHeads[0]).toMatchObject({ revision: 2 });
  const storedLines = await lines();
  expect(storedLines).toHaveLength(1);
  expect(storedLines[0]).toMatchObject({ net: '20.000', net_share: '20.000' });
  expect(await marks()).toHaveLength(2);
}, 30_000);
