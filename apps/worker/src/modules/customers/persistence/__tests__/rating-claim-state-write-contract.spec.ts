import { systemUuidV7 } from '@pospay/ids';
import { expect, it } from 'vitest';

import { RATING_CLAIM_STATE_SWEEP } from '../rating-claim-state-sweep.lua.ts';
import { redisRatingClaimState } from '../redis-rating-claim-state.ts';
import {
  validationHarness,
  type ValidationOptions,
  type ValidationWorld,
} from './rating-claim-state-harness.fixture.ts';
import { REQUEST_A } from './rating-claim-state-validation.fixture.ts';

const ids = systemUuidV7();
const MAX = Number.MAX_SAFE_INTEGER;
const { redis, harness, rawStateOf } = validationHarness();

/** نفس المفتاح والسور، وحدود مختلفة للأمر التالي فقط. */
function configured(world: ValidationWorld, options: ValidationOptions) {
  return redisRatingClaimState({ prefix: world.prefix, redis, backoffMs: 0, ...options });
}

/** مجلة حقيقية معلقة، عشان رفض التسوية يثبت بقاء العمل والنسخة معًا. */
async function pendingPage(options: ValidationOptions = {}) {
  const world = await harness(options);
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
  return {
    ...world,
    fence: { ...world.fence, expectedVersion: enrolled.version },
    pageId,
    workToken,
  };
}

/** حجز إعادة فعلي يثبت أن رفض requeue أو takeover لا يمحو رموز الملكية. */
async function reservedRetry() {
  const world = await pendingPage();
  const settled = await world.state.settlePage(world.fence, world.pageId, world.workToken, 'RETRY');
  expect(settled.code).toBe('OK');
  const reservationToken = ids.newId();
  const reserved = await world.state.reserveRetries(
    { ...world.fence, expectedVersion: settled.version },
    1,
    [reservationToken],
  );
  expect(reserved.code).toBe('OK');
  expect(reserved.value?.reservations).toHaveLength(1);
  return {
    ...world,
    fence: { ...world.fence, expectedVersion: reserved.version },
    reservationToken,
  };
}

/** الرفض لا يخزّن النسخة المرفوعة في الذاكرة ولا يضيّع السور القديم. */
async function unchanged(
  world: ValidationWorld,
  result: { readonly code: string; readonly version: number },
  before: string | null,
  code = 'LIMIT',
) {
  expect(result).toEqual({ code, version: world.fence.expectedVersion });
  expect(await redis.get(world.key)).toBe(before);
  expect((await world.state.read(world.companyId)).code).toBe('OK');
}

it('bounded exception: unsafe initial lease returns LIMIT/0 without creating a key', async () => {
  const world = await harness();
  await redis.del(world.key);
  const state = configured(world, { leaseMs: MAX, maxTurnMs: MAX });
  const result = await state.acquire(world.companyId, ids.newId(), ids.newId());
  expect(result).toEqual({ code: 'LIMIT', version: 0 });
  expect(await redis.get(world.key)).toBeNull();
  expect((await world.state.acquire(world.companyId, ids.newId(), ids.newId())).code).toBe('OK');
});

it('bounded exception: unsafe takeover retains old version, reservations and bytes', async () => {
  const world = await reservedRetry();
  const raw = await rawStateOf(world);
  raw['leaseUntil'] = 0;
  raw['turnStartedAt'] = 0;
  const before = JSON.stringify(raw);
  await redis.set(world.key, before);
  const state = configured(world, { leaseMs: MAX, maxTurnMs: MAX });
  await unchanged(world, await state.acquire(world.companyId, ids.newId(), ids.newId()), before);
  const taken = await world.state.acquire(world.companyId, ids.newId(), ids.newId());
  expect(taken.code).toBe('OK');
  expect(taken.version).toBe(world.fence.expectedVersion + 1);
  expect(taken.value?.retries[REQUEST_A]?.ownerToken).toBeUndefined();
});

it('bounded exception: unsafe renewal rolls back its local bump and retains the fence', async () => {
  const world = await harness();
  const before = await redis.get(world.key);
  // الفرق الكبير عن سقف الدور يمرر حارس السقف؛ الوقت الناتج نفسه غير قابل للتخزين.
  const state = configured(world, { leaseMs: MAX - 1_000_000, maxTurnMs: MAX });
  await unchanged(world, await state.renew(world.fence), before);
  expect((await world.state.renew(world.fence)).code).toBe('OK');
});

it('bounded exception: unsafe page retry preserves the journal, ticket and version', async () => {
  const world = await pendingPage();
  const before = await redis.get(world.key);
  const state = configured(world, { backoffMs: MAX });
  await unchanged(
    world,
    await state.settlePage(world.fence, world.pageId, world.workToken, 'RETRY'),
    before,
  );
  expect(
    (await world.state.settlePage(world.fence, world.pageId, world.workToken, 'TERMINAL')).code,
  ).toBe('OK');
});

it('bounded exception: unsafe retry requeue retains the reserved token and version', async () => {
  const world = await reservedRetry();
  const before = await redis.get(world.key);
  const state = configured(world, { backoffMs: MAX });
  await unchanged(
    world,
    await state.settleRetry(world.fence, REQUEST_A, world.reservationToken, 'RETRY'),
    before,
  );
  expect(
    (await world.state.settleRetry(world.fence, REQUEST_A, world.reservationToken, 'TERMINAL'))
      .code,
  ).toBe('OK');
});

it('bounded exception: unsafe reservation stores no lease and preserves the old fence', async () => {
  const world = await pendingPage();
  const settled = await world.state.settlePage(world.fence, world.pageId, world.workToken, 'RETRY');
  const current = { ...world, fence: { ...world.fence, expectedVersion: settled.version } };
  const before = await redis.get(world.key);
  const state = configured(world, { leaseMs: MAX, maxTurnMs: MAX });
  await unchanged(current, await state.reserveRetries(current.fence, 1, [ids.newId()]), before);
  expect((await world.state.reserveRetries(current.fence, 1, [ids.newId()])).code).toBe('OK');
});

it('bounded exception: an empty upper bound returns LIMIT with unchanged state and version', async () => {
  const world = await harness();
  const before = await redis.get(world.key);
  await unchanged(world, await world.state.begin(world.fence, ids.newId(), ''), before);
  expect((await world.state.begin(world.fence, ids.newId(), null)).code).toBe('OK');
});

it.each(['version', 'incarnation', 'owner'] as const)(
  'bounded exception: %s fencing takes precedence over an unsafe result',
  async (field) => {
    const world = await pendingPage();
    const before = await redis.get(world.key);
    const fence =
      field === 'version'
        ? { ...world.fence, expectedVersion: world.fence.expectedVersion + 1 }
        : field === 'incarnation'
          ? { ...world.fence, incarnation: ids.newId() }
          : { ...world.fence, ownerToken: ids.newId() };
    const state = configured(world, { backoffMs: MAX });
    await unchanged(
      world,
      await state.settlePage(fence, world.pageId, world.workToken, 'RETRY'),
      before,
      field === 'owner' ? 'BUSY' : 'STALE',
    );
  },
);

it('bounded exception: an active sweep remains BUSY before checking an empty new upper bound', async () => {
  const world = await pendingPage();
  const before = await redis.get(world.key);
  await unchanged(world, await world.state.begin(world.fence, ids.newId(), ''), before, 'BUSY');
});

it('bounded exception: MAX backoff still accepts a representable future due date', async () => {
  const world = await pendingPage();
  const [seconds, micros] = await redis.time();
  const dueAt = new Date(Number(seconds) * 1000 + Math.floor(Number(micros) / 1000) + 60_000);
  const state = configured(world, { backoffMs: MAX });
  const result = await state.settlePage(world.fence, world.pageId, world.workToken, 'RETRY', dueAt);
  expect(result.code).toBe('OK');
  expect(result.value?.retries[REQUEST_A]?.eligibleAt).toBe(dueAt.getTime());
  expect((await world.state.read(world.companyId)).code).toBe('OK');
});

it('bounded exception: MAX turn with an ordinary lease remains writable and readable', async () => {
  const world = await pendingPage({ maxTurnMs: MAX });
  const settled = await world.state.settlePage(world.fence, world.pageId, world.workToken, 'RETRY');
  const reserved = await world.state.reserveRetries(
    { ...world.fence, expectedVersion: settled.version },
    1,
    [ids.newId()],
  );
  expect(reserved.code).toBe('OK');
  expect(reserved.value?.reservations).toHaveLength(1);
  const read = await world.state.read(world.companyId);
  expect(read.code).toBe('OK');
  expect(Number.isSafeInteger(read.value?.retries[REQUEST_A]?.leaseUntil)).toBe(true);
});

it('bounded exception: byte rollback discards unsafe eligibility but keeps the valid OVERFLOW write', async () => {
  const world = await pendingPage({ maxBytes: 100_000, reserveBytes: 99_900, backoffMs: MAX });
  const before = await world.state.read(world.companyId);
  const result = await world.state.settlePage(world.fence, world.pageId, world.workToken, 'RETRY');
  expect(result.code).toBe('OVERFLOW');
  expect(result.version).toBe(world.fence.expectedVersion + 1);
  expect(result.value?.nextTicket).toBe(before.value?.nextTicket);
  expect(result.value?.retries).toEqual({});
  expect(result.value?.page?.entries).toEqual([]);
  expect((await world.state.read(world.companyId)).code).toBe('OK');
});

it('bounded exception: capacity overflow does not reject an unused MAX backoff', async () => {
  const world = await pendingPage({ capacity: 0, backoffMs: MAX });
  const result = await world.state.settlePage(world.fence, world.pageId, world.workToken, 'RETRY');
  expect(result.code).toBe('OVERFLOW');
  expect(result.value?.overflowCount).toBe(1);
  expect((await world.state.read(world.companyId)).code).toBe('OK');
});

it.each([null, undefined, REQUEST_A])(
  'bounded exception: optional upper bound %s remains valid',
  async (upperId) => {
    const world = await harness();
    const result = await redis.eval(
      RATING_CLAIM_STATE_SWEEP,
      1,
      world.key,
      JSON.stringify({
        companyId: world.companyId,
        incarnation: world.fence.incarnation,
        ownerToken: world.fence.ownerToken,
        version: world.fence.expectedVersion,
        action: 'begin',
        sweepId: ids.newId(),
        upperId,
        maxBytes: 1_048_576,
      }),
    );
    expect((JSON.parse(String(result)) as { code: string }).code).toBe('OK');
    const read = await world.state.read(world.companyId);
    expect(read.code).toBe('OK');
    expect(read.value?.upperId).toBe(upperId ?? undefined);
  },
);

it.each([
  { leaseMs: 0, maxTurnMs: 0 },
  { leaseMs: -2, maxTurnMs: -1 },
])('bounded exception: existing expired-ownership policy is unchanged for %j', async (options) => {
  const world = await harness(options);
  expect((await world.state.read(world.companyId)).code).toBe('OK');
  const before = await redis.get(world.key);
  await unchanged(world, await world.state.begin(world.fence, ids.newId(), null), before, 'BUSY');
});

it('bounded exception: negative backoff retains the existing immediate-eligibility policy', async () => {
  const world = await pendingPage({ backoffMs: -1 });
  const result = await world.state.settlePage(world.fence, world.pageId, world.workToken, 'RETRY');
  expect(result.code).toBe('OK');
  expect((await world.state.read(world.companyId)).code).toBe('OK');
});
