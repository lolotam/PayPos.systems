import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Queue } from 'bullmq';
import {
  createOutboxDispatcherDatabase,
  type ClaimedEvent,
  type DeliveryOutcome,
  type OutboxDispatcherDatabase,
} from '@pospay/db';
import { createLogger } from '@pospay/observability';

import { discoverRatingClaims } from '../../../../../packages/db/src/data-steps/rating-claims-discovery.ts';
import { readPgTestEnv } from '../../../../../packages/db/test/pg-env.ts';
import { TENANT, USER } from '../../../../../packages/db/test/tenancy-fixtures.ts';
import { createDeliverer } from '../../outbox/deliver.ts';
import { deliverFilesEvent } from '../../outbox/files-deliver.ts';
import { daySessionsReader } from '../../modules/orders/index.ts';
import {
  createRatingSchedulingConsumer,
  startRatingClaimsWorker,
  type RatingClaimsWorker,
} from '../../modules/customers/index.ts';
import {
  RATING_CLAIMS_QUEUE,
  RATING_CLAIMS_TRIGGERS,
} from '../../modules/customers/jobs/rating-claims.processor.ts';
import {
  everyDay,
  ratingClaimsFixture,
  testTokenHash,
  type RatingClaimsFixture,
} from './rating-claims.fixture.ts';

const KUWAIT = 'Asia/Kuwait';
const TEN_TO_TEN = everyDay([{ opens: '10:00', closes: '22:00' }]);
const VISIT = new Date('2026-06-01T12:10:00.000Z');
const DISCOVERY = 'RatingClaimsDiscoveryRequested';

let f!: RatingClaimsFixture;
let worker!: RatingClaimsWorker;
// بيانات الجدولة هي اللي في الطابور، فالنوع بيوضح الشكل بدل ما نبقي على any.
let queue!: Queue<{ companyId: string }>;
let dispatcher!: OutboxDispatcherDatabase;
let prefix: string;
// الطابور بيتعمل في beforeEach؛ لو الـ beforeEach وقع قبل ما يتعمل، ما فيش تنظيف عليه.
let queueOpen = false;

beforeEach(async () => {
  // الـ globalSetup بيقرا ملفات الإعدادات في process بتاعه بس، والاختبار محتاجها في process بتاعه.
  readPgTestEnv();
  const redisUrl =
    process.env['REDIS_URL'] ??
    `redis://:${encodeURIComponent(process.env['REDIS_PASSWORD'] ?? '')}@127.0.0.1:6379`;
  f = await ratingClaimsFixture();
  prefix = `rating-claims-test-${f.ids.newId()}`;
  worker = startRatingClaimsWorker({
    database: f.db,
    ids: f.ids,
    clock: f.clock,
    daySessions: daySessionsReader,
    redisUrl,
    prefix,
    logger: createLogger('silent'),
    deriver: {
      claim: (identity) => ({ tokenHash: testTokenHash(identity.ratingRequestId), keyVersion: 1 }),
    },
  });
  await worker.ready();
  queue = new Queue<{ companyId: string }>(RATING_CLAIMS_QUEUE, {
    connection: { url: redisUrl },
    prefix,
  });
  queueOpen = true;
  dispatcher = createOutboxDispatcherDatabase({ url: f.testDb.dispatcherUrl });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await worker?.close();
  if (queueOpen) {
    // تنظيف اللي احنا بس اللي فتحناه: بادئة خاصة بالاختبار، ومفتاح الجدولة بتاع شركتنا.
    await queue
      .removeJobScheduler(`${RATING_CLAIMS_QUEUE}-${TENANT.A.company}`)
      .catch(() => undefined);
    await queue.obliterate({ force: true });
    await queue.close();
    queueOpen = false;
  }
  await dispatcher?.close();
  await f?.close();
});

/**
 * حالة الشركة قبل نشر 59b-2: طلب تقييم مجدول من زيارة قديمة، وحدث الزيارة اتسلّم قبل ما
 * 59b-2 ينشر (59-1 كان بيستهلك الزيارة)، فما فيش جدولة مطالبة اتسجلت ولا زيارة جديدة.
 */
async function requestBeforeDeploy(): Promise<string> {
  const branchId = await f.branch({ timezone: KUWAIT, openingHours: TEN_TO_TEN });
  const customer = await f.customer();
  const session = await f.session({ customerId: customer, branchId, occurredAt: VISIT });
  await f.schedule(session.sessionId);
  await f.owner`UPDATE outbox SET published_at = clock_timestamp()
    WHERE company_id = ${TENANT.A.company} AND event_type = 'ServiceSessionRecorded'`;
  await f.owner`INSERT INTO rating_settings(company_id,id,business_id,requests_enabled,updated_by)
    VALUES(${TENANT.A.company}, ${f.ids.newId()}, ${TENANT.A.business}, true, ${USER})`;
  f.clock.at = new Date('2026-06-01T13:30:00.000Z');
  return customer;
}

/** سلسلة التسليم نفسها اللي في جذر العامل: الـ dispatcher يسلّم الحدث، والمعالج يسجّل الجدولة. */
function deliveryChain(): (event: ClaimedEvent) => Promise<DeliveryOutcome> {
  const businessDeliver = createDeliverer(f.db, [worker.consumer], createLogger('silent'), {
    knownEventTypes: RATING_CLAIMS_TRIGGERS,
  });
  return (event: ClaimedEvent) =>
    deliverFilesEvent(event, {
      register: async () => ({ delivered: true }),
      staff: (claimed, next) => next(claimed),
      core: (claimed) => worker.deliver(claimed, businessDeliver),
    });
}

/** بيدوّر على المطالبة اللي اتعملت، والحدث الوحيد اللي المفروض يطلع. */
async function waitForClaim(customerId: string): Promise<void> {
  await vi.waitFor(
    async () => {
      const row = await f.request(customerId);
      expect(row?.['status']).toBe('SENDING');
    },
    { timeout: 10_000, interval: 50 },
  );
}

it('the discovery event of the migration data step registers the schedule and claims the request', async () => {
  const customer = await requestBeforeDeploy();

  const counts = await discoverRatingClaims(f.owner, f.db);
  expect(counts.discovered).toBe(1);
  expect(await queue.getJobSchedulers()).toHaveLength(0);

  expect(await dispatcher.dispatchBatch(10, deliveryChain())).toBe(1);

  const schedules = await queue.getJobSchedulers();
  expect(schedules).toHaveLength(1);
  expect(schedules[0]?.template?.data).toEqual({ companyId: TENANT.A.company });
  await waitForClaim(customer);
  expect(await f.readyEvents()).toHaveLength(1);
});

it('the same discovery event delivered again keeps one schedule and one claim', async () => {
  const customer = await requestBeforeDeploy();
  await discoverRatingClaims(f.owner, f.db);
  const deliver = deliveryChain();
  let claimed: ClaimedEvent | undefined;
  await dispatcher.dispatchBatch(10, async (event) => {
    claimed = event;
    return deliver(event);
  });
  expect(claimed).toBeDefined();

  expect(await deliver(claimed as ClaimedEvent)).toEqual({ delivered: true });
  expect(await queue.getJobSchedulers()).toHaveLength(1);
  await waitForClaim(customer);
  expect(await f.readyEvents()).toHaveLength(1);
});

it('a visit created after the data step registers through the normal scheduling delivery', async () => {
  const customer = await requestBeforeDeploy();
  await discoverRatingClaims(f.owner, f.db);
  const later = await f.session({
    customerId: customer,
    branchId: TENANT.A.branch,
    occurredAt: new Date('2026-06-01T13:00:00.000Z'),
  });

  const event = await f.event(later.sessionId, 'ServiceSessionRecorded');
  // الزيارة 13:00 تستحق 14:00؛ نضع الساعة عند الاستحقاق قبل تسجيل المهمة، لا نغيّر التوقع ولا ننتظر ساعة حقيقية.
  f.clock.at = new Date('2026-06-01T14:00:00.000Z');
  expect(await deliveryChain()(event)).toEqual({ delivered: true });
  expect(await queue.getJobSchedulers()).toHaveLength(1);
  await waitForClaim(customer);
});

it('recovers a late visit acknowledged by the old worker when no discovery event exists', async () => {
  const branchId = await f.branch({ timezone: KUWAIT, openingHours: TEN_TO_TEN });
  const customer = await f.customer();
  await f.owner`INSERT INTO rating_settings(company_id,id,business_id,requests_enabled,updated_by)
    VALUES(${TENANT.A.company}, ${f.ids.newId()}, ${TENANT.A.business}, true, ${USER})`;
  f.clock.at = new Date('2026-06-01T13:30:00.000Z');

  // الشركة لم يكن عندها طلب وقت data step، لذلك لا يوجد حدث اكتشاف أصلي يمكن إعادته.
  expect((await discoverRatingClaims(f.owner, f.db)).discovered).toBe(0);
  const late = await f.session({
    customerId: customer,
    branchId,
    occurredAt: new Date('2026-06-01T13:00:00.000Z'),
  });
  const lateEvent = await f.event(late.sessionId, 'ServiceSessionRecorded');
  const scheduling = createRatingSchedulingConsumer({
    ids: f.ids,
    clock: f.clock,
    daySessions: daySessionsReader,
  });
  const oldWorker = createDeliverer(f.db, [scheduling], createLogger('silent'), {
    knownEventTypes: scheduling.eventTypes,
  });
  expect(await dispatcher.dispatchBatch(10, oldWorker)).toBe(1);
  expect(await dispatcher.ratingClaimsDiscoveryReplay(TENANT.A.company)).toBeNull();

  const replay = await dispatcher.ratingClaimsVisitReplayPage(TENANT.A.company, null, null, 100);
  expect(replay.events.map((event) => event.id)).toEqual([lateEvent.id]);
  f.clock.at = new Date('2026-06-01T14:00:00.000Z');
  for (const event of replay.events) {
    expect(await deliveryChain()(event)).toEqual({ delivered: true });
  }

  await waitForClaim(customer);
  expect(await f.readyEvents()).toHaveLength(1);
  const visits = await f.owner`SELECT count(*)::int AS count FROM service_sessions
    WHERE company_id = ${TENANT.A.company} AND customer_id = ${customer}`;
  expect(visits[0]?.['count']).toBe(1);
});

it('recovers a discovery event parked by old workers through the new release replay', async () => {
  const customer = await requestBeforeDeploy();
  await discoverRatingClaims(f.owner, f.db);
  const oldWorker = createDeliverer(f.db, [], createLogger('silent'), { knownEventTypes: [] });

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    await f.owner`UPDATE outbox SET next_attempt_at = clock_timestamp()
      WHERE company_id = ${TENANT.A.company} AND event_type = ${DISCOVERY}`;
    expect(await dispatcher.dispatchBatch(10, oldWorker)).toBe(1);
  }
  const parked = await f.owner`SELECT attempts, parked_at FROM outbox
    WHERE company_id = ${TENANT.A.company} AND event_type = ${DISCOVERY}`;
  expect(parked[0]?.['attempts']).toBe(10);
  expect(parked[0]?.['parked_at']).not.toBeNull();

  const stored = await dispatcher.ratingClaimsDiscoveryReplay(TENANT.A.company);
  expect(stored).toMatchObject({ eventType: DISCOVERY, attempt: 10 });
  if (stored === null) throw new Error('DISCOVERY_EVENT_MISSING');
  const replay = await deliveryChain()(stored);

  expect(replay).toEqual({ delivered: true });
  expect(await queue.getJobSchedulers()).toHaveLength(1);
  await waitForClaim(customer);
  const afterReplay = await f.owner`SELECT attempts, parked_at FROM outbox
    WHERE company_id = ${TENANT.A.company} AND event_type = ${DISCOVERY}`;
  expect(afterReplay[0]).toEqual(parked[0]);
});

it('a scheduling failure is not acknowledged and the dispatcher retries the same stored event', async () => {
  const customer = await requestBeforeDeploy();
  await discoverRatingClaims(f.owner, f.db);

  // الفشل قبل أول تسليم: الـ dispatcher يسلّم الحدث المخزّن، والمعالج يفشل في تسجيل الجدولة
  // فيردّ «مش متسلّم» بدل ما يعدّي، فالمحاولة الجاية لازم تاخد نفس الصف تاني.
  const fail = vi
    .spyOn(Queue.prototype, 'upsertJobScheduler')
    .mockRejectedValueOnce(new Error('synthetic scheduling failure'));
  // الرقم اللي بيرجع هو عدد الأحداث اللي الـ dispatcher اخدها، مش عدد اللي اتسلّمت.
  expect(await dispatcher.dispatchBatch(10, deliveryChain())).toBe(1);
  fail.mockRestore();

  // الحدث ما اتنشرش: الخطأ اتسجل على الصف، والموعد الجاي اتحسب من لحظة الفشل.
  const failed = await f.owner`SELECT published_at, attempts, last_error, next_attempt_at
    FROM outbox WHERE company_id = ${TENANT.A.company} AND event_type = ${DISCOVERY}`;
  expect(failed).toHaveLength(1);
  expect(failed[0]?.['published_at']).toBeNull();
  expect(failed[0]?.['attempts']).toBe(1);
  expect(failed[0]?.['last_error']).toBe('RATING_CLAIMS_SCHEDULE_RETRY');
  expect(await queue.getJobSchedulers()).toHaveLength(0);

  // نقدّم موعد المحاولة الجاية على الصف نفسه بدل ما ننتظر، والـ dispatcher يسلّم نفس الحدث المخزّن.
  await f.owner`UPDATE outbox SET next_attempt_at = clock_timestamp()
    WHERE company_id = ${TENANT.A.company} AND event_type = ${DISCOVERY}`;

  expect(await dispatcher.dispatchBatch(10, deliveryChain())).toBe(1);

  const published = await f.owner`SELECT published_at, attempts FROM outbox
    WHERE company_id = ${TENANT.A.company} AND event_type = ${DISCOVERY}`;
  expect(published).toHaveLength(1);
  expect(published[0]?.['published_at']).not.toBeNull();
  expect(published[0]?.['attempts']).toBe(2);

  const schedules = await queue.getJobSchedulers();
  expect(schedules).toHaveLength(1);
  expect(schedules[0]?.template?.data).toEqual({ companyId: TENANT.A.company });
  await waitForClaim(customer);
  expect(await f.readyEvents()).toHaveLength(1);
});
