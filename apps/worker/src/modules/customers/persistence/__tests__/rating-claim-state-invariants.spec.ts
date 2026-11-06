import { systemUuidV7 } from '@pospay/ids';
import { expect, it } from 'vitest';

import { validationHarness, type ValidationOptions } from './rating-claim-state-harness.fixture.ts';
import {
  damageState,
  PAGE_DAMAGE,
  REQUEST_A,
  REQUEST_B,
  sweepingState,
} from './rating-claim-state-validation.fixture.ts';

const ids = systemUuidV7();
const { redis, harness, rawStateOf, refuseAll } = validationHarness();

/** الكُتّاب الحقيقيون يثبتوا التقدم قبل تغيير حقل أو تسوية طرف الصفحة. */
async function pagedWorld(options: ValidationOptions = {}) {
  const world = await harness(options);
  const sweepId = ids.newId();
  const pageId = ids.newId();
  const tokens = [ids.newId(), ids.newId()] as const;
  const begun = await world.state.begin(world.fence, sweepId, REQUEST_B);
  expect(begun.code).toBe('OK');
  const enrolled = await world.state.enrollPage(
    { ...world.fence, expectedVersion: begun.version },
    sweepId,
    null,
    pageId,
    [
      { requestId: REQUEST_A, workToken: tokens[0] },
      { requestId: REQUEST_B, workToken: tokens[1] },
    ],
    true,
    10,
  );
  expect(enrolled.code).toBe('OK');
  return {
    ...world,
    fence: { ...world.fence, expectedVersion: enrolled.version },
    sweepId,
    pageId,
    tokens,
  };
}

it.each(PAGE_DAMAGE)('R1: $name is CORRUPT with unchanged bytes', async (damage) => {
  const world = await harness();
  const raw = sweepingState(await rawStateOf(world));
  await redis.set(world.key, JSON.stringify(raw));
  expect((await world.state.read(world.companyId)).code).toBe('OK');
  damageState(raw, damage);
  await redis.set(world.key, JSON.stringify(raw));
  await refuseAll(world);
});

it('R1: enrollment refuses duplicate work tokens without writing a corrupt journal', async () => {
  const world = await harness();
  const sweepId = ids.newId();
  const begun = await world.state.begin(world.fence, sweepId, REQUEST_B);
  const before = await redis.get(world.key);
  const token = ids.newId();
  const enrolled = await world.state.enrollPage(
    { ...world.fence, expectedVersion: begun.version },
    sweepId,
    null,
    ids.newId(),
    [
      { requestId: REQUEST_A, workToken: token },
      { requestId: REQUEST_B, workToken: token },
    ],
    true,
    10,
  );
  expect(enrolled).toEqual({ code: 'LIMIT', version: begun.version });
  expect(await redis.get(world.key)).toBe(before);
});

it('R1: settling the tail preserves a higher cursor than the remaining entry', async () => {
  const world = await pagedWorld();
  const tail = await world.state.settlePage(world.fence, world.pageId, world.tokens[1], 'TERMINAL');
  expect(tail.code).toBe('OK');
  expect(tail.value?.page?.entries.map((entry) => entry.requestId)).toEqual([REQUEST_A]);
  expect(tail.value?.cursorId).toBe(REQUEST_B);
  expect(tail.value?.page?.throughId).toBe(REQUEST_B);
  expect((await world.state.read(world.companyId)).code).toBe('OK');
  const drained = await world.state.settlePage(
    { ...world.fence, expectedVersion: tail.version },
    world.pageId,
    world.tokens[0],
    'TERMINAL',
  );
  expect(drained.code).toBe('OK');
  expect(drained.value?.page?.entries).toEqual([]);
  expect(drained.value?.cursorId).toBe(REQUEST_B);
  const finished = await world.state.finish(
    { ...world.fence, expectedVersion: drained.version },
    world.sweepId,
  );
  expect(finished.code).toBe('OK');
});

it('R1: a captured upper bound permits an empty first page with no cursor', async () => {
  const world = await harness();
  const sweepId = ids.newId();
  const begun = await world.state.begin(world.fence, sweepId, REQUEST_B);
  const enrolled = await world.state.enrollPage(
    { ...world.fence, expectedVersion: begun.version },
    sweepId,
    null,
    ids.newId(),
    [],
    true,
    10,
  );
  expect(enrolled.code).toBe('OK');
  expect(enrolled.value?.cursorId).toBeUndefined();
  expect(enrolled.value?.page?.throughId).toBeUndefined();
  expect((await world.state.read(world.companyId)).code).toBe('OK');
  const finished = await world.state.finish(
    { ...world.fence, expectedVersion: enrolled.version },
    sweepId,
  );
  expect(finished.code).toBe('OK');
});

const OVERFLOW_PATHS = [
  { name: 'capacity', options: { capacity: 0 } },
  { name: 'encoded bytes', options: { maxBytes: 100_000, reserveBytes: 99_900 } },
] as const;

it.each(
  OVERFLOW_PATHS.flatMap((path) =>
    ['overflowCount', 'sweepOverflowCount'].map((field) => ({ ...path, field })),
  ),
)(
  'R1: $name overflow at $field MAX_SAFE returns LIMIT without writing',
  async ({ options, field }) => {
    const world = await pagedWorld(options);
    const raw = await rawStateOf(world);
    raw[field] = Number.MAX_SAFE_INTEGER;
    raw['reconcileRequired'] = true;
    const stored = JSON.stringify(raw);
    await redis.set(world.key, stored);
    // LIMIT بيرجع النسخة الصغيرة الأصلية بس؛ قراءة قيمة العدّاد الكبير نفسها تظل ضمن #887.
    const result = await world.state.settlePage(
      world.fence,
      world.pageId,
      world.tokens[0],
      'RETRY',
    );
    expect(result).toEqual({ code: 'LIMIT', version: world.fence.expectedVersion });
    expect(await redis.get(world.key)).toBe(stored);
  },
);

it.each(OVERFLOW_PATHS)(
  'R1: $name overflow increments representable counters once',
  async ({ options }) => {
    const world = await pagedWorld(options);
    const raw = await rawStateOf(world);
    raw['overflowCount'] = 99_999_999_999_998;
    raw['sweepOverflowCount'] = 99_999_999_999_998;
    raw['reconcileRequired'] = true;
    await redis.set(world.key, JSON.stringify(raw));
    const result = await world.state.settlePage(
      world.fence,
      world.pageId,
      world.tokens[0],
      'RETRY',
    );
    expect(result.code).toBe('OVERFLOW');
    expect(result.value?.overflowCount).toBe(99_999_999_999_999);
    expect(result.value?.reconcileRequired).toBe(true);
    const stored = await rawStateOf(world);
    expect(stored['sweepOverflowCount']).toBe(99_999_999_999_999);
    expect((await world.state.read(world.companyId)).code).toBe('OK');
  },
);

it('R1: historical cumulative overflow may have a cleared reconciliation flag', async () => {
  const world = await harness();
  const raw = await rawStateOf(world);
  raw['overflowCount'] = 8;
  raw['overflowSince'] = 0;
  delete raw['sweepOverflowCount'];
  await redis.set(world.key, JSON.stringify(raw));
  const renewed = await world.state.renew(world.fence);
  expect(renewed.code).toBe('OK');
  expect(renewed.value?.reconcileRequired).toBe(false);
  expect(renewed.value?.overflowCount).toBe(8);
});

it('R2: sparse historical tickets reserve oldest first regardless of map iteration order', async () => {
  const world = await harness();
  const raw = await rawStateOf(world);
  raw['nextTicket'] = 40;
  raw['retries'] = {
    [REQUEST_B]: { ticket: 20, eligibleAt: 0 },
    [REQUEST_A]: { ticket: 3, eligibleAt: 0 },
  };
  delete raw['sweepOverflowCount'];
  await redis.set(world.key, JSON.stringify(raw));
  expect((await world.state.read(world.companyId)).code).toBe('OK');
  const reserved = await world.state.reserveRetries(world.fence, 2, [ids.newId(), ids.newId()]);
  expect(reserved.code).toBe('OK');
  expect(reserved.value?.reservations.map((entry) => entry.requestId)).toEqual([
    REQUEST_A,
    REQUEST_B,
  ]);
  const read = await world.state.read(world.companyId);
  expect(read.value?.nextTicket).toBe(40);
  expect(read.value?.retries[REQUEST_A]?.ticket).toBe(3);
  expect(read.value?.retries[REQUEST_B]?.ticket).toBe(20);
});
