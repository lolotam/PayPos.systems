import { createOutboxDispatcherDatabase } from '@pospay/db';
import { Queue } from 'bullmq';
import { afterEach, expect, it } from 'vitest';

import { discoverRatingClaims } from '../../../../../packages/db/src/data-steps/rating-claims-discovery.ts';
import { recoverRatingClaims, startRatingClaimsRegistrar } from '../../modules/customers/index.ts';
import {
  RATING_CLAIMS_QUEUE,
  startRatingClaimsProcessor,
} from '../../modules/customers/jobs/rating-claims.processor.ts';
import { ratingClaimsWorld, redisUrl } from './rating-claims-world.fixture.ts';
import { waitForReadyEvents } from './rating-claims-recovery.fixture.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.reverse()) await close();
  cleanups.length = 0;
});

it('inventory recovers pre-deploy scheduled work through parked discovery and a lost scheduler without a new visit', async () => {
  const world = await ratingClaimsWorld({ tokens: true });
  cleanups.push(() => world.close());
  const seeded = await world.seedDueRequests({ count: 1, first: 700 });
  const reader = createOutboxDispatcherDatabase({ url: world.base.testDb.dispatcherUrl });
  cleanups.push(() => reader.close());
  const counts = await discoverRatingClaims(world.base.owner, world.base.db, reader);
  expect(counts.discoveryEvents).toBe(1);
  await world.base.owner`UPDATE outbox SET parked_at=now(),attempts=10
    WHERE event_type='RatingClaimsDiscoveryRequested'`;
  const discovery = await world.base.owner`SELECT row_to_json(o)::text AS snapshot FROM outbox o
    WHERE event_type='RatingClaimsDiscoveryRequested'`;
  const prefix = `${world.prefix}:discovery`;
  const registrar = startRatingClaimsRegistrar({ redisUrl, prefix });
  cleanups.push(() => registrar.close());
  const queue = new Queue(RATING_CLAIMS_QUEUE, { connection: world.redis, prefix });
  cleanups.push(async () => {
    for (const scheduler of await queue.getJobSchedulers())
      await queue.removeJobScheduler(scheduler.key);
    await queue.obliterate({ force: true });
    await queue.close();
  });
  const deps = {
    reader,
    registrar,
    deliverSchedules: async () => {
      throw new Error('DISCOVERY_MUST_NOT_SCHEDULE_VISITS');
    },
  };
  const cursor = { companyId: world.company, afterId: null, throughId: null };
  await recoverRatingClaims(deps, cursor);
  expect(await world.readyRequestIds()).toEqual([]);
  await queue.removeJobScheduler(`${RATING_CLAIMS_QUEUE}-${world.company}`);
  expect(await queue.getJobSchedulers()).toHaveLength(0);
  await recoverRatingClaims(deps, cursor);
  expect(await queue.getJobSchedulers()).toHaveLength(1);
  // العامل هنا اختبار تفعيل صريح؛ جذر الإنتاج يظل مغلقًا.
  const processor = startRatingClaimsProcessor({
    redisUrl,
    prefix,
    turn: world.worker(),
  });
  cleanups.push(() => processor.close());
  await processor.ready();
  const ready = await waitForReadyEvents(world, [world.company]);
  expect(ready.get(world.company)).toEqual([...seeded.requestIds]);
  await recoverRatingClaims(deps, cursor);
  await world.turn();
  expect(await world.readyRequestIds()).toEqual([...seeded.requestIds]);
  expect(
    await world.base.owner`SELECT row_to_json(o)::text AS snapshot FROM outbox o
    WHERE event_type='RatingClaimsDiscoveryRequested'`,
  ).toEqual(discovery);
}, 120_000);
