import { systemUuidV7 } from '@pospay/ids';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

import type { ClaimStateFence, RatingClaimState } from '../../ports/rating-claim-state.port.ts';
import {
  redisRatingClaimState,
  type RatingClaimStateOptions,
} from '../redis-rating-claim-state.ts';
import { REQUEST_A } from './rating-claim-state-validation.fixture.ts';

const ids = systemUuidV7();

/** حالة اختبار لها مفتاح مملوك وسور حقيقي، حتى يظل فحص البايتات معزولًا لكل حالة. */
export interface ValidationWorld {
  readonly state: RatingClaimState;
  readonly prefix: string;
  readonly companyId: string;
  readonly key: string;
  readonly fence: ClaimStateFence;
}

/** حدود الاختبار التقنية فقط؛ العميل والمفتاح يظلان ملك الـharness. */
export type ValidationOptions = Partial<
  Pick<
    RatingClaimStateOptions,
    'capacity' | 'maxBytes' | 'reserveBytes' | 'backoffMs' | 'leaseMs' | 'maxTurnMs'
  >
>;

/** منفذ حالة ببادئة ومفتاح خاصين بالاختبار، والمعرف اللي استعملناه. */
async function acquire(
  redis: Redis,
  owned: string[],
  options: ValidationOptions,
): Promise<ValidationWorld> {
  const prefix = `pospay-test-rating-claims-corrupt-${ids.newId()}`;
  const companyId = ids.newId();
  const key = `${prefix}:rating-claims:v1:{${companyId}}:state`;
  owned.push(key);
  const state = redisRatingClaimState({ prefix, redis, backoffMs: 0, ...options });
  const ownerToken = ids.newId();
  const acquired = await state.acquire(companyId, ids.newId(), ownerToken);
  expect(acquired.code).toBe('OK');
  const snapshot = acquired.value;
  if (snapshot === undefined) throw new Error('RATING_CLAIM_STATE_MISSING_SNAPSHOT');
  return {
    state,
    prefix,
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
async function rawStateOf(redis: Redis, world: ValidationWorld): Promise<Record<string, unknown>> {
  const raw = await redis.get(world.key);
  if (raw === null) throw new Error('RATING_CLAIM_STATE_MISSING');
  return JSON.parse(raw) as Record<string, unknown>;
}

/**
 * كل أمر بيشوف الحالة المتضررة، وكلهم لازم يرجعوا CORRUPT.
 *
 * @param redis عميل Redis الخاص بالاختبار
 * @param world منفذ الحالة والمفتاح
 * @returns لا شيء
 */
async function refuseAll(redis: Redis, world: ValidationWorld): Promise<void> {
  const before = await redis.get(world.key);
  const commands = [
    () => world.state.acquire(world.companyId, ids.newId(), ids.newId()),
    () => world.state.renew(world.fence),
    () => world.state.release(world.fence),
    () => world.state.reserveRetries(world.fence, 1, [ids.newId()]),
    () => world.state.begin(world.fence, ids.newId(), null),
    () =>
      world.state.enrollPage(
        world.fence,
        ids.newId(),
        null,
        ids.newId(),
        [{ requestId: ids.newId(), workToken: ids.newId() }],
        false,
        10,
      ),
    () => world.state.settlePage(world.fence, ids.newId(), ids.newId(), 'TERMINAL'),
    () => world.state.settleRetry(world.fence, REQUEST_A, ids.newId(), 'TERMINAL'),
    () => world.state.finish(world.fence, ids.newId()),
    () => world.state.read(world.companyId),
  ];
  for (const command of commands) {
    await expect(command()).resolves.toMatchObject({ code: 'CORRUPT' });
    expect(await redis.get(world.key)).toBe(before);
  }
}

/** تهيئة مستقلة لكل ملف؛ نفس إثبات الرفض والبايتات يُعاد استعماله بدل نسخ الأوامر العشرة. */
export function validationHarness() {
  const redisUrl =
    process.env['REDIS_URL'] ||
    `redis://:${process.env['REDIS_PASSWORD'] || 'pospay_dev_redis'}@127.0.0.1:6379`;
  const redis = new Redis(redisUrl, { lazyConnect: true });
  const owned: string[] = [];
  beforeAll(async () => {
    await redis.connect();
    await redis.ping();
  });
  afterEach(async () => {
    if (owned.length > 0) await redis.del(...owned.splice(0, owned.length));
  });
  afterAll(async () => {
    await redis.quit();
  });
  return {
    redis,
    harness: (options: ValidationOptions = {}) => acquire(redis, owned, options),
    rawStateOf: (world: ValidationWorld) => rawStateOf(redis, world),
    refuseAll: (world: ValidationWorld) => refuseAll(redis, world),
  };
}
