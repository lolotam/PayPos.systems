import { systemUuidV7 } from '@pospay/ids';
import { afterEach, expect, it, vi } from 'vitest';

import { RATING_CLAIM_STATE_SWEEP } from '../rating-claim-state-sweep.lua.ts';
import { RatingClaimStateConfigError } from '../redis-rating-claim-state.context.ts';
import { redisRatingClaimState } from '../redis-rating-claim-state.ts';
import { validationHarness } from './rating-claim-state-harness.fixture.ts';
import { REQUEST_A } from './rating-claim-state-validation.fixture.ts';

const ids = systemUuidV7();
const { redis, harness } = validationHarness();
afterEach(() => vi.restoreAllMocks());

it.each([
  { name: 'leaseMs', options: { leaseMs: 1000.5 } },
  { name: 'backoffMs', options: { backoffMs: 0.5 } },
  { name: 'maxTurnMs', options: { maxTurnMs: 1000.5 } },
])(
  'R3: fractional $name is rejected before Redis and preserves existing bytes',
  async ({ options }) => {
    const world = await harness();
    const before = await redis.get(world.key);
    // نراقب حد Redis الحقيقي من غير استبداله؛ الرفض لازم يحصل أثناء التهيئة.
    const evalsha = vi.spyOn(redis, 'evalsha');
    const evaluate = vi.spyOn(redis, 'eval');
    expect(() =>
      redisRatingClaimState({
        prefix: world.prefix,
        redis,
        leaseMs: 1000,
        maxTurnMs: 2000,
        backoffMs: 0,
        ...options,
      }),
    ).toThrowError(new RatingClaimStateConfigError('RATING_CLAIM_STATE_DURATION_INVALID'));
    expect(evalsha).not.toHaveBeenCalled();
    expect(evaluate).not.toHaveBeenCalled();
    expect(await redis.get(world.key)).toBe(before);
  },
);

const BAD_IDS = [undefined, null, '', 0, false, {}, []].map((value) => ({
  value,
  label: value === undefined ? 'missing' : JSON.stringify(value),
}));

it.each(
  (['begin', 'enrollPage'] as const).flatMap((action) =>
    BAD_IDS.map((entry) => ({ action, ...entry })),
  ),
)('R3: $action refuses $label ID with LIMIT and unchanged bytes', async ({ action, value }) => {
  const world = await harness();
  const sweepId = ids.newId();
  const version =
    action === 'begin'
      ? world.fence.expectedVersion
      : (await world.state.begin(world.fence, sweepId, REQUEST_A)).version;
  const before = await redis.get(world.key);
  const envelope = {
    companyId: world.companyId,
    incarnation: world.fence.incarnation,
    ownerToken: world.fence.ownerToken,
    version,
    action,
    sweepId: action === 'begin' ? value : sweepId,
    pageId: action === 'enrollPage' ? value : ids.newId(),
    upperId: REQUEST_A,
    entries: [],
    exhausted: true,
    maxEntries: 1,
    maxBytes: 1_048_576,
  };
  const result = await redis.eval(RATING_CLAIM_STATE_SWEEP, 1, world.key, JSON.stringify(envelope));
  expect(JSON.parse(String(result))).toEqual({ code: 'LIMIT', version });
  expect(await redis.get(world.key)).toBe(before);
  expect((await world.state.read(world.companyId)).code).toBe('OK');
});

it('R3: integer durations and zero backoff preserve writable retry state', async () => {
  const world = await harness({ leaseMs: 60_000, maxTurnMs: 60_000, backoffMs: 0 });
  const sweepId = ids.newId();
  const pageId = ids.newId();
  const workToken = ids.newId();
  const begun = await world.state.begin(world.fence, sweepId, REQUEST_A);
  expect(begun.code).toBe('OK');
  const enrolled = await world.state.enrollPage(
    { ...world.fence, expectedVersion: begun.version },
    sweepId,
    null,
    pageId,
    [{ requestId: REQUEST_A, workToken }],
    true,
    1,
  );
  expect(enrolled.code).toBe('OK');
  const settled = await world.state.settlePage(
    { ...world.fence, expectedVersion: enrolled.version },
    pageId,
    workToken,
    'RETRY',
  );
  expect(settled.code).toBe('OK');
  expect(Number.isInteger(settled.value?.retries[REQUEST_A]?.eligibleAt)).toBe(true);
  const reserved = await world.state.reserveRetries(
    { ...world.fence, expectedVersion: settled.version },
    1,
    [ids.newId()],
  );
  expect(reserved.code).toBe('OK');
  expect(reserved.value?.reservations).toHaveLength(1);
  const read = await world.state.read(world.companyId);
  expect(read.code).toBe('OK');
  expect(Number.isInteger(read.value?.leaseUntil)).toBe(true);
  expect(Number.isInteger(read.value?.retries[REQUEST_A]?.leaseUntil)).toBe(true);
});

it('R3: nonempty sweep and page IDs remain accepted and readable', async () => {
  const world = await harness();
  const sweepId = ids.newId();
  const pageId = ids.newId();
  const begun = await world.state.begin(world.fence, sweepId, REQUEST_A);
  expect(begun.code).toBe('OK');
  const enrolled = await world.state.enrollPage(
    { ...world.fence, expectedVersion: begun.version },
    sweepId,
    null,
    pageId,
    [],
    true,
    1,
  );
  expect(enrolled.code).toBe('OK');
  const read = await world.state.read(world.companyId);
  expect(read.code).toBe('OK');
  expect(read.value?.sweepId).toBe(sweepId);
  expect(read.value?.page?.pageId).toBe(pageId);
});
