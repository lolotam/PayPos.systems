// حد حجم الحالة: التسوية اللي بتشيل بند بتتقفل بالحجم الكامل، والتسوية اللي بتضيف
// إعادة محاولة لازم تسيب المساحة المحجوزة للصفحة الجاية.
import { systemUuidV7 } from '@pospay/ids';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';

import { FORWARD_VISITS } from '../../domain/rating-claim-scheduling.ts';
import type {
  ClaimStateFence,
  ClaimStateResult,
  ClaimStateSnapshot,
} from '../../ports/rating-claim-state.port.ts';
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

afterAll(async () => {
  await redis.quit();
});

afterEach(async () => {
  if (owned.length > 0) await redis.del(...owned.splice(0, owned.length));
});

/** منفذ حالة ببادئة ومفتاح خاصين بالاختبار. */
function harness(options: { maxBytes: number; reserveBytes: number }) {
  const prefix = `pospay-test-rating-claims-${ids.newId()}`;
  const companyId = ids.newId();
  const key = `${prefix}:rating-claims:v1:{${companyId}}:state`;
  owned.push(key);
  return { state: redisRatingClaimState({ prefix, redis, ...options }), companyId, key, prefix };
}

/** سور من لقطة الحالة. */
function fenceOf(
  acquired: ClaimStateResult<ClaimStateSnapshot>,
  ownerToken: string,
): ClaimStateFence {
  const snapshot = acquired.value;
  if (snapshot === undefined) throw new Error('RATING_CLAIM_STATE_SNAPSHOT_MISSING');
  return {
    companyId: snapshot.companyId,
    incarnation: snapshot.incarnation,
    expectedVersion: acquired.version,
    ownerToken,
  };
}

it('a_removal_only_settlement_is_stored_against_the_full_byte_cap', async () => {
  // السقف المحجوز أقل من حجم الحالة، فأي إضافة بتتجاوزه؛ والحالة نفسها تحت السقف الكامل.
  const world = harness({ maxBytes: 100_000, reserveBytes: 99_900 });
  const ownerToken = ids.newId();
  const acquired = await world.state.acquire(world.companyId, ids.newId(), ownerToken);
  expect(acquired.code).toBe('OK');
  const fence = fenceOf(acquired, ownerToken);
  const first = ids.newId();
  const second = ids.newId();
  const upper = first > second ? first : second;
  const sweepId = ids.newId();
  const pageId = ids.newId();
  const firstToken = ids.newId();
  const secondToken = ids.newId();
  const begun = await world.state.begin(fence, sweepId, upper);
  expect(begun.code).toBe('OK');
  const enrolled = await world.state.enrollPage(
    { ...fence, expectedVersion: begun.version },
    sweepId,
    null,
    pageId,
    [
      { requestId: first, workToken: firstToken },
      { requestId: second, workToken: secondToken },
    ],
    false,
    FORWARD_VISITS,
  );
  expect(enrolled.code).toBe('OK');
  // التسوية الأولى بتشيل البند بس: مفيش إضافة، فالحجم الكامل كفاية والتسوية بتنجح.
  const removed = await world.state.settlePage(
    { ...fence, expectedVersion: enrolled.version },
    pageId,
    firstToken,
    'TERMINAL',
  );
  expect(removed.code).toBe('OK');
  expect(removed.value?.overflowCount).toBe(0);
  // التسوية التانية بتضيف بند إعادة، وحجمها أكبر من السقف المحجوز، فالفيضان بيتسجل.
  const inserted = await world.state.settlePage(
    { ...fence, expectedVersion: removed.version },
    pageId,
    secondToken,
    'RETRY',
  );
  expect(inserted.code).toBe('OVERFLOW');
  expect(inserted.value?.overflowCount).toBe(1);
  expect(inserted.value?.reconcileRequired).toBe(true);
  expect(Object.keys(inserted.value?.retries ?? {})).toHaveLength(0);
  // الرجوع بيسيب رقم التذكرة زي ما كان، والحالة المخزّنة محفوظة بنفسها.
  expect(inserted.value?.nextTicket).toBe(removed.value?.nextTicket);
  const stored = JSON.parse((await redis.get(world.key)) ?? '{}') as { nextTicket: number };
  expect(stored.nextTicket).toBe(removed.value?.nextTicket);
});

it('the state cap counts utf-8 bytes, and one byte over it is refused', async () => {
  const world = harness({ maxBytes: 1_000_000, reserveBytes: 0 });
  const ownerToken = ids.newId();
  const acquired = await world.state.acquire(world.companyId, ids.newId(), ownerToken);
  expect(acquired.code).toBe('OK');
  const fence = fenceOf(acquired, ownerToken);
  const raw = JSON.parse((await redis.get(world.key)) ?? '{}') as Record<string, unknown>;
  raw['note'] = 'مرحبا 🌟';
  const seeded = JSON.stringify(raw);
  await redis.set(world.key, seeded);
  const bytes = Buffer.byteLength(seeded, 'utf8');
  const characters = seeded.length;
  expect(bytes).toBeGreaterThan(characters);
  // سقف بالحروف بس: الرفض بيثبت إن السقف بيتحسب بالبايت مش بالحرف.
  const limited = (maxBytes: number) =>
    redisRatingClaimState({ prefix: world.prefix, redis, maxBytes, reserveBytes: 0 });
  const before = await redis.get(world.key);
  const refused = await limited(characters).renew(fence);
  expect(refused.code).toBe('LIMIT');
  expect(await redis.get(world.key)).toBe(before);
  // السقف بالبايت بالظبط بيقبل، وبايت واحد فوقه بيرفض من غير كتابة.
  const accepted = await limited(bytes).renew(fence);
  expect(accepted.code).toBe('OK');
  const after = await redis.get(world.key);
  const overflowed = await limited(bytes - 1).renew({
    ...fence,
    expectedVersion: accepted.version,
  });
  expect(overflowed.code).toBe('LIMIT');
  expect(await redis.get(world.key)).toBe(after);
});
