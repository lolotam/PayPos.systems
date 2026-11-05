// حالة متضررة: JSON بيتقرأ بس ناقص حقول. الأوامر لازم ترفضها CORRUPT من غير أي
// كتابة، والمفتاح لازم يفضل زي ما هو بالبايت.
import { systemUuidV7 } from '@pospay/ids';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';

import type { ClaimStateFence, RatingClaimState } from '../../ports/rating-claim-state.port.ts';
import { redisRatingClaimState } from '../redis-rating-claim-state.ts';

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
}

/** منفذ حالة ببادئة ومفتاح خاصين بالاختبار، والمعرف اللي استعملناه. */
async function harness(): Promise<Harness> {
  const prefix = `pospay-test-rating-claims-corrupt-${ids.newId()}`;
  const companyId = ids.newId();
  const key = `${prefix}:rating-claims:v1:{${companyId}}:state`;
  owned.push(key);
  const state = redisRatingClaimState({ prefix, redis });
  const ownerToken = ids.newId();
  const acquired = await state.acquire(companyId, ids.newId(), ownerToken);
  expect(acquired.code).toBe('OK');
  const snapshot = acquired.value;
  if (snapshot === undefined) throw new Error('RATING_CLAIM_STATE_MISSING_SNAPSHOT');
  return {
    state,
    companyId,
    key,
    fence: {
      companyId,
      incarnation: snapshot.incarnation,
      expectedVersion: snapshot.version,
      ownerToken,
    },
  };
}

/** الحالة السليمة بعد الاستلام، عشان ن damage منها نسخة. */
async function rawStateOf(world: Harness): Promise<Record<string, unknown>> {
  const raw = await redis.get(world.key);
  if (raw === null) throw new Error('RATING_CLAIM_STATE_MISSING');
  return JSON.parse(raw) as Record<string, unknown>;
}

/**
 * كل أمر بيشوف الحالة المتضررة، وكلهم لازم يرجعوا CORRUPT.
 *
 * @param world منفذ الحالة والمفتاح
 * @returns لا شيء
 */
async function refuseAll(world: Harness): Promise<void> {
  const acquired = await world.state.acquire(world.companyId, ids.newId(), ids.newId());
  expect(acquired.code).toBe('CORRUPT');
  const renewed = await world.state.renew(world.fence);
  expect(renewed.code).toBe('CORRUPT');
  const reserved = await world.state.reserveRetries(world.fence, 1, [ids.newId()]);
  expect(reserved.code).toBe('CORRUPT');
  const begun = await world.state.begin(world.fence, ids.newId(), null);
  expect(begun.code).toBe('CORRUPT');
  const enrolled = await world.state.enrollPage(
    world.fence,
    ids.newId(),
    null,
    ids.newId(),
    [{ requestId: ids.newId(), workToken: ids.newId() }],
    false,
    10,
  );
  expect(enrolled.code).toBe('CORRUPT');
  const settled = await world.state.settlePage(world.fence, ids.newId(), ids.newId(), 'TERMINAL');
  expect(settled.code).toBe('CORRUPT');
  const read = await world.state.read(world.companyId);
  expect(read.code).toBe('CORRUPT');
}

it('a retry entry without its eligibility is refused and never written over', async () => {
  const world = await harness();
  const damaged = await rawStateOf(world);
  // مدخل إعادة من غير استحقاق: المسار التاني ما بيقدرش يخدمه، والمسار الأمامي
  // كان بيسلّمه DELEGATED فيفضل الطلب مجدول للأبد.
  damaged['retries'] = { [ids.newId()]: { ticket: 7 } };
  const damagedRaw = JSON.stringify(damaged);
  await redis.set(world.key, damagedRaw);
  await refuseAll(world);
  expect(await redis.get(world.key)).toBe(damagedRaw);
});

it('a journal entry without its work token is refused and never written over', async () => {
  const world = await harness();
  const damaged = await rawStateOf(world);
  damaged['page'] = {
    pageId: ids.newId(),
    sweepId: ids.newId(),
    exhausted: true,
    entries: [{ requestId: ids.newId() }],
  };
  const damagedRaw = JSON.stringify(damaged);
  await redis.set(world.key, damagedRaw);
  await refuseAll(world);
  expect(await redis.get(world.key)).toBe(damagedRaw);
});

it('a state without its fence fields is refused and never written over', async () => {
  const world = await harness();
  const damaged = await rawStateOf(world);
  damaged['incarnation'] = undefined;
  const damagedRaw = JSON.stringify(damaged);
  await redis.set(world.key, damagedRaw);
  await refuseAll(world);
  expect(await redis.get(world.key)).toBe(damagedRaw);
});
