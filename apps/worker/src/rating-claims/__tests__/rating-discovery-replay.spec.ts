import {
  createOutboxDispatcherDatabase,
  type ClaimedEvent,
  type OutboxDispatcherDatabase,
} from '@pospay/db';
import { RATING_CLAIMS_DISCOVERY } from '@pospay/contracts';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { afterEach, expect, it } from 'vitest';
import { createLogger } from '@pospay/observability';

import { createDeliverer } from '../../outbox/deliver.ts';
import { daySessionsReader } from '../../modules/orders/index.ts';
import {
  createRatingSchedulingConsumer,
  recoverRatingClaims,
  startRatingClaimsRegistrar,
} from '../../modules/customers/index.ts';
import {
  RATING_CLAIMS_QUEUE,
  type RatingClaimsRegistrar,
} from '../../modules/customers/jobs/rating-claims.registration.ts';
import { ratingClaimsFixture, type RatingClaimsFixture } from './rating-claims.fixture.ts';

let world: RatingClaimsFixture;
let reader: OutboxDispatcherDatabase;
let registrar: RatingClaimsRegistrar;
let connection: Redis;
let queue: Queue;
import { redisUrl } from './rating-claims-world.fixture.ts';

afterEach(async () => {
  await registrar?.close();
  if (queue) {
    for (const scheduler of await queue.getJobSchedulers())
      await queue.removeJobScheduler(scheduler.key);
    await queue.obliterate({ force: true });
    await queue.close();
  }
  connection?.disconnect();
  await reader?.close();
  await world?.close();
});

async function setup() {
  world = await ratingClaimsFixture();
  world.clock.at = new Date('2026-06-01T13:30:00Z');
  reader = createOutboxDispatcherDatabase({ url: world.testDb.dispatcherUrl });
  const prefix = `discovery-${world.ids.newId()}`;
  registrar = startRatingClaimsRegistrar({ redisUrl, prefix });
  connection = new Redis(redisUrl);
  queue = new Queue(RATING_CLAIMS_QUEUE, { connection, prefix });
  await registrar.ready();
  const consumer = createRatingSchedulingConsumer({
    ids: world.ids,
    clock: world.clock,
    daySessions: daySessionsReader,
    ratingSwitch: world.enabled,
  });
  const deliverSchedules = createDeliverer(world.db, [consumer], createLogger('silent'), {
    knownEventTypes: consumer.eventTypes,
  });
  return { reader, registrar, deliverSchedules };
}

async function oldVisit() {
  const customerId = await world.customer();
  const branchId = await world.branch({ timezone: 'Asia/Kuwait' });
  const session = await world.session({
    customerId,
    branchId,
    occurredAt: new Date('2026-06-01T08:00:00Z'),
    recordedAt: new Date('2026-06-01T13:00:00Z'),
  });
  const event = await world.event(session.sessionId, 'ServiceSessionRecorded');
  // العامل القديم أقر الحدث دون مستهلك الجدولة؛ replay لا يغير إقرار المرسل.
  await world.owner`UPDATE outbox SET published_at=now(),attempts=3 WHERE id=${event.id}`;
  return { customerId, event };
}

it('recovers an old-worker-acknowledged late visit after a lost commit reply, then claims exactly once', async () => {
  const deps = await setup();
  const { customerId } = await oldVisit();
  const before = await outboxMetadata();
  let lost = true;
  const deliverSchedules = async (event: ClaimedEvent) => {
    const result = await deps.deliverSchedules(event);
    if (lost) {
      lost = false;
      return { delivered: false as const, error: 'SYNTHETIC_LOST_REPLY', retryInMs: 5000 };
    }
    return result;
  };
  const cursor = { companyId: world.company.toUpperCase(), afterId: null, throughId: null };
  const first = await recoverRatingClaims({ ...deps, deliverSchedules }, cursor);
  expect(first).toMatchObject({ complete: false, afterId: null, replayed: 0 });
  expect((await world.request(customerId))?.status).toBe('SCHEDULED');
  const retry = await recoverRatingClaims(deps, { ...cursor, throughId: first.throughId });
  expect(retry.complete).toBe(true);
  expect(await world.requestIds(customerId)).toHaveLength(1);
  const [requestId] = await world.requestIds(customerId);
  if (!requestId) throw new Error('TEST_REQUEST_MISSING');
  expect(await world.claimOne(requestId)).toBe('CLAIMED');
  await recoverRatingClaims(deps, cursor);
  expect((await world.request(customerId))?.status).toBe('SENDING');
  expect(await world.readyEvents()).toHaveLength(1);
  expect(await outboxMetadata(before.map((row) => String(row['id'])))).toEqual(before);
});

it('replays parked discovery after Redis loss and concurrent registration without claiming or modifying outbox', async () => {
  const deps = await setup();
  const id = world.ids.newId();
  await world.owner`INSERT INTO outbox(company_id,id,aggregate_type,aggregate_id,event_type,payload,parked_at,attempts)
    VALUES (${world.company},${id},'rating_claims_discovery',${world.company},${RATING_CLAIMS_DISCOVERY},'{}',now(),10)`;
  const before = await outboxMetadata();
  const cursor = { companyId: world.company.toUpperCase(), afterId: null, throughId: null };
  await Promise.all([recoverRatingClaims(deps, cursor), recoverRatingClaims(deps, cursor)]);
  expect(await queue.getJobSchedulers()).toHaveLength(1);
  await queue.removeJobScheduler(`${RATING_CLAIMS_QUEUE}-${world.company}`);
  expect(await queue.getJobSchedulers()).toHaveLength(0);
  expect((await recoverRatingClaims(deps, cursor)).complete).toBe(true);
  expect(await queue.getJobSchedulers()).toHaveLength(1);
  expect(await world.readyEvents()).toEqual([]);
  expect(await outboxMetadata()).toEqual(before);
});

it('does not acknowledge a source when registration fails and retries it without another visit', async () => {
  const deps = await setup();
  const { customerId } = await oldVisit();
  const cursor = { companyId: world.company.toUpperCase(), afterId: null, throughId: null };
  const unavailable = {
    ensureRegistered: async () => {
      throw new Error('SYNTHETIC_REDIS_FAILURE');
    },
  };
  await expect(recoverRatingClaims({ ...deps, registrar: unavailable }, cursor)).rejects.toThrow(
    'SYNTHETIC_REDIS_FAILURE',
  );
  expect(await world.request(customerId)).toBeUndefined();
  expect((await recoverRatingClaims(deps, cursor)).complete).toBe(true);
  expect((await world.request(customerId))?.status).toBe('SCHEDULED');
});

async function outboxMetadata(onlyIds?: string[]) {
  return onlyIds
    ? world.owner`SELECT id,published_at,attempts,next_attempt_at,parked_at,last_error FROM outbox
        WHERE id IN ${world.owner(onlyIds)} ORDER BY id`
    : world.owner`SELECT id,published_at,attempts,next_attempt_at,parked_at,last_error FROM outbox ORDER BY id`;
}
