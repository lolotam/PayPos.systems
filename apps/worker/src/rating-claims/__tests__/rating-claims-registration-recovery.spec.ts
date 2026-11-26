import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import {
  createOutboxDispatcherDatabase,
  type ClaimedEvent,
  type DeliveryOutcome,
  type OutboxDispatcherDatabase,
} from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

import {
  RATING_CLAIMS_QUEUE,
  startRatingClaimsProcessor,
} from '../../modules/customers/jobs/rating-claims.processor.ts';
import { recoverRatingClaims } from '../../modules/customers/jobs/recover-rating-claims.ts';
import {
  everyDay,
  ratingSchedulingFixture,
  type RatingSchedulingFixture,
} from '../../rating-scheduling/__tests__/rating-scheduling.fixture.ts';

const redisUrl =
  process.env['REDIS_URL'] ||
  `redis://:${process.env['REDIS_PASSWORD'] || 'pospay_dev_redis'}@127.0.0.1:6379`;
const TEN_TO_TEN = everyDay([{ opens: '10:00', closes: '22:00' }]);
const TRIGGERS = ['ServiceSessionRecorded', 'ServiceSessionLinesAdded', 'ServiceLineChanged'];

let f: RatingSchedulingFixture;
let dispatcher: OutboxDispatcherDatabase;
let queue: Queue;
let connection: Redis;
let processor: ReturnType<typeof startRatingClaimsProcessor>;
let head: ClaimedEvent;
let later: ClaimedEvent;
let customer: string;
const delays: (number | null)[] = [];

/** دور خدمة بيشتغل وبيخلص عادي؛ التسجيل هو اللي بيتعطّل في الاختبار. */
const noopTurn = () => ({
  execute: async () => ({
    settlements: { TERMINAL: 0, ABSENT: 0, FUTURE_UNATTEMPTED: 0, RETRY: 0, DELEGATED: 0 },
    forwardVisits: 0,
    retryVisits: 0,
    end: 'COMPLETED' as const,
  }),
});

beforeAll(async () => {
  f = await ratingSchedulingFixture();
  dispatcher = createOutboxDispatcherDatabase({ url: f.testDb.dispatcherUrl });
  const prefix = `pospay-test-rating-claims-${systemUuidV7().newId()}`;
  connection = new Redis(redisUrl);
  queue = new Queue(RATING_CLAIMS_QUEUE, { connection, prefix });
  processor = startRatingClaimsProcessor({
    redisUrl,
    prefix,
    turn: noopTurn(),
    logger: createLogger('silent'),
  });
  const branchId = await f.branch({ timezone: 'Asia/Kuwait', openingHours: TEN_TO_TEN });
  customer = await f.customer();
  const session = await f.session({
    customerId: customer,
    branchId,
    occurredAt: new Date('2026-06-01T12:10:00.000Z'),
  });
  head = await f.event(session.sessionId, 'ServiceSessionRecorded');
  later = await f.event(session.sessionId, 'ServiceSessionLinesAdded');
});

afterAll(async () => {
  await dispatcher?.close();
  await queue?.obliterate({ force: true }).catch(() => undefined);
  await queue?.close();
  await connection?.quit();
  await f?.close();
});

/** التسليم بالترتيب: تسجيل الجدولة الأول، وبعدين مستهلك الجدولة. */
const chained = async (event: ClaimedEvent): Promise<DeliveryOutcome> => {
  const outcome = await processor.deliver(event, f.deliver);
  if (!outcome.delivered) delays.push(outcome.retryInMs);
  return outcome;
};

/** ساعة الاختبار بتتقدم: موعد المحاولة الجاية بيتاخد من جديد بدل انتظار PP-97 كله. */
const releaseLease = async (): Promise<void> => {
  await f.owner`UPDATE outbox SET next_attempt_at = clock_timestamp()
    WHERE company_id = ${f.tenant.company} AND published_at IS NULL`;
};

it('a registration failure parks the trigger after ten attempts with the PP-97 backoff', async () => {
  const spy = vi
    .spyOn(Queue.prototype, 'upsertJobScheduler')
    .mockRejectedValue(new Error('SYNTHETIC_REGISTRATION_FAILURE'));
  try {
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      await releaseLease();
      await dispatcher.dispatchBatch(50, chained);
    }
  } finally {
    spy.mockRestore();
  }
  expect(delays).toEqual([
    5_000,
    10_000,
    20_000,
    40_000,
    80_000,
    160_000,
    320_000,
    640_000,
    1_280_000,
    null,
  ]);
  expect(await f.owner`SELECT attempts, parked_at FROM outbox WHERE id = ${head.id}`).toMatchObject(
    [{ attempts: 10, parked_at: expect.any(Date) }],
  );
  // الحدث الأحدث من نفس المجمّع اتقفل ورا رأسه الموقوف.
  expect(
    await f.owner`SELECT attempts, published_at FROM outbox WHERE id = ${later.id}`,
  ).toMatchObject([{ attempts: 0, published_at: null }]);
  // مستهلك الجدولة ما اشتغلش خالص، فما فيش طلب تقييم.
  expect(await f.requests(customer)).toHaveLength(0);
});

it('recovery re-registers the company and delivers the parked and the later event in order', async () => {
  // خطوة المشغّل: إيقاف الجدولة المفقودة في Redis، كأن الـ Redis اتمسح.
  await queue.removeJobScheduler(`${RATING_CLAIMS_QUEUE}-${f.tenant.company}`);
  // خطوة المشغّل: الأحداث الموقفة بترجع تستحق التسليم من أولها.
  await f.owner`UPDATE outbox SET parked_at = NULL, attempts = 0, next_attempt_at = clock_timestamp(),
      last_error = NULL
    WHERE published_at IS NULL AND parked_at IS NOT NULL
      AND event_type = ANY(${f.owner.array(TRIGGERS)})`;
  const recovery = await recoverRatingClaims(
    {
      reader: dispatcher,
      registrar: { ensureRegistered: (companyId) => processor.ensureRegistered(companyId) },
      deliverSchedules: (event) => f.deliver(event),
    },
    { companyId: f.tenant.company, afterId: null, throughId: null },
  );
  expect(recovery).toMatchObject({ complete: true, replayed: 2 });
  expect(await queue.getJobScheduler(`${RATING_CLAIMS_QUEUE}-${f.tenant.company}`)).toBeDefined();
  // الحدثان اتسلّموا بالترتيب، والنتيجة طلب واحد.
  expect(await f.requests(customer)).toHaveLength(1);
  const applied = await f.owner`SELECT event_id FROM consumed_events
    WHERE company_id = ${f.tenant.company} AND consumer_id = ${f.consumer.id}`;
  expect(applied.map((row) => row['event_id'])).toEqual([head.id, later.id]);
  // التسليم التاني بعد الاستعادة ما بيزودش صف ولا بيعدّي تحديث.
  for (let round = 0; round < 3; round += 1) await dispatcher.dispatchBatch(50, chained);
  expect(await f.requests(customer)).toHaveLength(1);
});

it('recovery is idempotent once the downstream effect is committed', async () => {
  const again = await recoverRatingClaims(
    {
      reader: dispatcher,
      registrar: { ensureRegistered: (companyId) => processor.ensureRegistered(companyId) },
      deliverSchedules: (event) => f.deliver(event),
    },
    { companyId: f.tenant.company, afterId: null, throughId: null },
  );
  expect(again).toMatchObject({ complete: true, replayed: 2 });
  // تكرار الاستعادة ما بيكتبش صف تاني، ولا بيغيّرش صف الطلب.
  expect(await f.requests(customer)).toHaveLength(1);
  const applied = await f.owner`SELECT event_id FROM consumed_events
    WHERE company_id = ${f.tenant.company} AND consumer_id = ${f.consumer.id}`;
  expect(applied).toHaveLength(2);
});
