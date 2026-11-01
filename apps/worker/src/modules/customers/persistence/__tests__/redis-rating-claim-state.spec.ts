import { setTimeout as delay } from 'node:timers/promises';

import { systemUuidV7 } from '@pospay/ids';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';

import type {
  ClaimStateFence,
  ClaimStateSnapshot,
  RatingClaimState,
} from '../../ports/rating-claim-state.port.ts';
import {
  redisRatingClaimState,
  type RatingClaimStateOptions,
} from '../redis-rating-claim-state.ts';

const ids = systemUuidV7();
const redisUrl =
  process.env['REDIS_URL'] ||
  `redis://:${process.env['REDIS_PASSWORD'] || 'pospay_dev_redis'}@127.0.0.1:6379`;

let redis: Redis;
const owned: string[] = [];

beforeAll(async () => {
  redis = new Redis(redisUrl);
  await redis.ping();
});

afterEach(async () => {
  if (owned.length > 0) await redis.del(...owned.splice(0, owned.length));
});

afterAll(async () => {
  await redis.quit();
});

interface Harness {
  readonly state: RatingClaimState;
  readonly companyId: string;
  readonly key: string;
  readonly fence: ClaimStateFence;
  readonly snapshot: ClaimStateSnapshot;
}

/** منفذ حالة ببادئة ومفتاح خاصين بالاختبار، والمعرف اللي استعملناه. */
async function harness(options: Partial<RatingClaimStateOptions> = {}): Promise<Harness> {
  const prefix = `pospay-test-rating-claims-${ids.newId()}`;
  const companyId = ids.newId();
  const key = `${prefix}:rating-claims:v1:{${companyId}}:state`;
  owned.push(key);
  const state = redisRatingClaimState({ prefix, redis, ...options });
  const ownerToken = ids.newId();
  const acquired = await state.acquire(companyId, ids.newId(), ownerToken);
  expect(acquired.code).toBe('OK');
  const snapshot = acquired.value;
  if (snapshot === undefined) throw new Error('RATING_CLAIM_STATE_MISSING_SNAPSHOT');
  return {
    state,
    companyId,
    key,
    snapshot,
    fence: {
      companyId,
      incarnation: snapshot.incarnation,
      expectedVersion: snapshot.version,
      ownerToken,
    },
  };
}

/** سور بنسخة مختلفة، عشان نختبر رفض السور القديم. */
function withVersion(fence: ClaimStateFence, version: number): ClaimStateFence {
  return { ...fence, expectedVersion: version };
}

/** جولة بدأت وحدّها المقطوع، وده الأساس لكل اختبارات تسجيل الصفحة. */
async function begunSweep(world: Harness) {
  const sweepId = ids.newId();
  const first = ids.newId();
  const second = ids.newId();
  const third = ids.newId();
  const begun = await world.state.begin(world.fence, sweepId, third);
  expect(begun.code).toBe('OK');
  return { sweepId, first, second, third, fence: withVersion(world.fence, begun.version) };
}

/** صفحة فيها بندين اتسجلت في الجولة، وده أساس اختبارات التسوية. */
async function enrolledPage(world: Harness, sweep: ReturnType<typeof begunSweep>) {
  const pageId = ids.newId();
  const firstToken = ids.newId();
  const secondToken = ids.newId();
  const enrolled = await world.state.enrollPage(
    sweep.fence,
    sweep.sweepId,
    null,
    pageId,
    [
      { requestId: sweep.first, workToken: firstToken },
      { requestId: sweep.second, workToken: secondToken },
    ],
    false,
  );
  expect(enrolled.code).toBe('OK');
  return { pageId, firstToken, secondToken, version: enrolled.version };
}

it('acquire on missing state creates version 1 with a fresh incarnation', async () => {
  const world = await harness();
  expect(world.snapshot.version).toBe(1);
  expect(world.snapshot.incarnation).toBeTruthy();
  expect(world.snapshot.phase).toBe('IDLE');
  expect(world.snapshot.retries).toEqual({});
  expect(world.snapshot.nextTicket).toBe(1);
});

it('acquire against a live owner is refused with BUSY', async () => {
  const world = await harness();
  const second = await world.state.acquire(world.companyId, ids.newId(), ids.newId());
  expect(second.code).toBe('BUSY');
  expect(second.version).toBe(world.snapshot.version);
});

it('takeover after the lease expiry keeps the progress and moves the version', async () => {
  const world = await harness({ leaseMs: 50 });
  const sweepId = ids.newId();
  const begun = await world.state.begin(world.fence, sweepId, null);
  expect(begun.code).toBe('OK');
  await delay(150);
  const taken = await world.state.acquire(world.companyId, ids.newId(), ids.newId());
  expect(taken.code).toBe('OK');
  expect(taken.version).toBeGreaterThan(world.snapshot.version);
  expect(taken.value?.phase).toBe('SWEEP');
  expect(taken.value?.sweepId).toBe(sweepId);
});

it('a stale version is refused with STALE', async () => {
  const world = await harness();
  const stale = await world.state.begin(
    withVersion(world.fence, world.snapshot.version + 1),
    ids.newId(),
    null,
  );
  expect(stale.code).toBe('STALE');
});

it('recreated_state_rejects_all_old_fences', async () => {
  const world = await harness();
  const oldFence = world.fence;
  await redis.del(world.key);
  const recreated = await world.state.acquire(world.companyId, ids.newId(), ids.newId());
  expect(recreated.code).toBe('OK');
  expect(recreated.version).toBe(1);
  expect(recreated.value?.incarnation).not.toBe(oldFence.incarnation);
  const refused = await world.state.begin(oldFence, ids.newId(), null);
  expect(refused.code).toBe('STALE');
});

it('enrollPage refuses ids that are not increasing inside the captured bound', async () => {
  const world = await harness();
  const sweep = await begunSweep(world);
  const descending = await world.state.enrollPage(
    sweep.fence,
    sweep.sweepId,
    null,
    ids.newId(),
    [
      { requestId: sweep.second, workToken: ids.newId() },
      { requestId: sweep.first, workToken: ids.newId() },
    ],
    false,
  );
  expect(descending.code).toBe('LIMIT');
  const aboveBound = await world.state.enrollPage(
    sweep.fence,
    sweep.sweepId,
    null,
    ids.newId(),
    [{ requestId: ids.newId(), workToken: ids.newId() }],
    false,
  );
  expect(aboveBound.code).toBe('LIMIT');
  await enrolledPage(world, sweep);
  const state = await world.state.read(world.companyId);
  expect(state.value?.cursorId).toBe(sweep.second);
  expect(state.value?.page?.entries).toHaveLength(2);
});

it('an open journal refuses a second page, and the drained journal still fences', async () => {
  const world = await harness();
  const sweep = await begunSweep(world);
  const page = await enrolledPage(world, sweep);
  const busy = await world.state.enrollPage(
    withVersion(world.fence, page.version),
    sweep.sweepId,
    sweep.second,
    ids.newId(),
    [{ requestId: sweep.third, workToken: ids.newId() }],
    false,
  );
  expect(busy.code).toBe('BUSY');
  const settledFirst = await world.state.settlePage(
    withVersion(world.fence, page.version),
    page.pageId,
    page.firstToken,
    'TERMINAL',
  );
  expect(settledFirst.code).toBe('OK');
  const settledSecond = await world.state.settlePage(
    withVersion(world.fence, settledFirst.version),
    page.pageId,
    page.secondToken,
    'TERMINAL',
  );
  expect(settledSecond.code).toBe('OK');
  const drained = await world.state.read(world.companyId);
  expect(Array.isArray(drained.value?.page?.entries)).toBe(true);
  expect(drained.value?.page?.entries).toHaveLength(0);
  const wrongLowerBound = await world.state.enrollPage(
    withVersion(world.fence, settledSecond.version),
    sweep.sweepId,
    sweep.first,
    ids.newId(),
    [{ requestId: sweep.third, workToken: ids.newId() }],
    false,
  );
  expect(wrongLowerBound.code).toBe('STALE');
});

it('an empty sweep refuses a page with entries', async () => {
  const world = await harness();
  const sweepId = ids.newId();
  const begun = await world.state.begin(world.fence, sweepId, null);
  expect(begun.code).toBe('OK');
  const refused = await world.state.enrollPage(
    withVersion(world.fence, begun.version),
    sweepId,
    null,
    ids.newId(),
    [{ requestId: ids.newId(), workToken: ids.newId() }],
    false,
  );
  expect(refused.code).toBe('LIMIT');
});

it('enrollPage refuses a page larger than the forward budget', async () => {
  const world = await harness();
  const sweepId = ids.newId();
  const begun = await world.state.begin(world.fence, sweepId, null);
  const entries = Array.from({ length: 76 }, () => ({
    requestId: ids.newId(),
    workToken: ids.newId(),
  }));
  const refused = await world.state.enrollPage(
    withVersion(world.fence, begun.version),
    sweepId,
    null,
    ids.newId(),
    entries,
    false,
  );
  expect(refused.code).toBe('LIMIT');
});

it('reserveRetries picks the oldest ticket first and a requeue goes to the tail', async () => {
  const world = await harness({ backoffMs: 0 });
  const sweep = await begunSweep(world);
  const page = await enrolledPage(world, sweep);
  const settledFirst = await world.state.settlePage(
    withVersion(world.fence, page.version),
    page.pageId,
    page.firstToken,
    'RETRY',
  );
  expect(settledFirst.code).toBe('OK');
  const settledSecond = await world.state.settlePage(
    withVersion(world.fence, settledFirst.version),
    page.pageId,
    page.secondToken,
    'RETRY',
  );
  expect(settledSecond.code).toBe('OK');
  const fence = withVersion(world.fence, settledSecond.version);
  const reserved = await world.state.reserveRetries(fence, 1, [ids.newId()]);
  expect(reserved.code).toBe('OK');
  expect(reserved.value?.reservations).toHaveLength(1);
  expect(reserved.value?.reservations[0]?.requestId).toBe(sweep.first);
  const requeued = await world.state.settleRetry(
    withVersion(world.fence, reserved.version),
    sweep.first,
    reserved.value?.reservations[0]?.workToken ?? '',
    'RETRY',
  );
  expect(requeued.code).toBe('OK');
  expect(requeued.value?.retries[sweep.first]?.ticket).toBe(3);
  const next = await world.state.reserveRetries(
    withVersion(world.fence, requeued.version),
    1,
    [ids.newId()],
  );
  expect(next.value?.reservations[0]?.requestId).toBe(sweep.second);
});

it('reserveRetries with nothing eligible returns an empty array', async () => {
  const world = await harness();
  const reserved = await world.state.reserveRetries(world.fence, 1, [ids.newId()]);
  expect(reserved.code).toBe('OK');
  expect(reserved.value?.reservations).toEqual([]);
});

it('a lowered capacity reports OVERFLOW and asks for reconciliation', async () => {
  const world = await harness({ capacity: 1 });
  const sweep = await begunSweep(world);
  const page = await enrolledPage(world, sweep);
  const settledFirst = await world.state.settlePage(
    withVersion(world.fence, page.version),
    page.pageId,
    page.firstToken,
    'RETRY',
  );
  expect(settledFirst.code).toBe('OK');
  const overflowed = await world.state.settlePage(
    withVersion(world.fence, settledFirst.version),
    page.pageId,
    page.secondToken,
    'RETRY',
  );
  expect(overflowed.code).toBe('OVERFLOW');
  expect(overflowed.value?.reconcileRequired).toBe(true);
  expect(overflowed.value?.overflowCount).toBe(1);
});

it('a retry that does not fit the encoded state is released and recorded as overflow', async () => {
  const world = await harness({ maxBytes: 2000, reserveBytes: 1900 });
  const sweep = await begunSweep(world);
  const page = await enrolledPage(world, sweep);
  const overflowed = await world.state.settlePage(
    withVersion(world.fence, page.version),
    page.pageId,
    page.firstToken,
    'RETRY',
  );
  expect(overflowed.code).toBe('OVERFLOW');
  expect(overflowed.value?.page?.entries).toHaveLength(1);
  expect(overflowed.value?.reconcileRequired).toBe(true);
  expect(overflowed.value?.overflowCount).toBe(1);
  expect(Object.keys(overflowed.value?.retries ?? {})).toHaveLength(0);
});

it('finish refuses a sweep that visited nothing, and accepts an empty sweep', async () => {
  const world = await harness();
  const sweepId = ids.newId();
  const begun = await world.state.begin(world.fence, sweepId, ids.newId());
  expect(begun.code).toBe('OK');
  const refused = await world.state.finish(withVersion(world.fence, begun.version), sweepId);
  expect(refused.code).toBe('BUSY');
  const empty = await harness();
  const emptySweepId = ids.newId();
  const started = await empty.state.begin(empty.fence, emptySweepId, null);
  expect(started.code).toBe('OK');
  const closed = await empty.state.finish(withVersion(empty.fence, started.version), emptySweepId);
  expect(closed.code).toBe('OK');
  expect(closed.value?.phase).toBe('IDLE');
});

it('a corrupt state is reported and never overwritten', async () => {
  const world = await harness();
  await redis.set(world.key, 'not-a-state');
  const result = await world.state.acquire(world.companyId, ids.newId(), ids.newId());
  expect(result.code).toBe('CORRUPT');
  expect(await redis.get(world.key)).toBe('not-a-state');
});

it('an expired owner can neither renew nor release', async () => {
  const world = await harness({ leaseMs: 50 });
  await delay(150);
  const renewed = await world.state.renew(world.fence);
  expect(renewed.code).toBe('BUSY');
  const released = await world.state.release(world.fence);
  expect(released.code).toBe('BUSY');
});

it('read returns the stored state without any mutation', async () => {
  const world = await harness();
  const read = await world.state.read(world.companyId);
  expect(read.code).toBe('OK');
  expect(read.version).toBe(world.snapshot.version);
  expect(read.value?.incarnation).toBe(world.snapshot.incarnation);
});
