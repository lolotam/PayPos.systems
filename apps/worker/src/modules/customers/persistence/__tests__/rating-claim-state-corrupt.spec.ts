// حالة متضررة: JSON بيتقرأ بس ناقص حقول. الأوامر لازم ترفضها CORRUPT من غير أي
// كتابة، والمفتاح لازم يفضل زي ما هو بالبايت.
import { systemUuidV7 } from '@pospay/ids';
import { expect, it } from 'vitest';

import { RATING_CLAIM_STATE_SWEEP } from '../rating-claim-state-sweep.lua.ts';
import { validationHarness } from './rating-claim-state-harness.fixture.ts';
import {
  damageState,
  REQUEST_A,
  REQUEST_B,
  STATE_DAMAGE,
  sweepingState,
} from './rating-claim-state-validation.fixture.ts';

const ids = systemUuidV7();
const { redis, harness, rawStateOf, refuseAll } = validationHarness();

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

it.each(STATE_DAMAGE)(
  '$name is CORRUPT for every command without changing bytes',
  async (damage) => {
    const world = await harness();
    const damaged = sweepingState(await rawStateOf(world));
    await redis.set(world.key, JSON.stringify(damaged));
    expect((await world.state.read(world.companyId)).code).toBe('OK');
    damageState(damaged, damage);
    await redis.set(world.key, JSON.stringify(damaged));
    await refuseAll(world);
  },
);

it.each(['sweepId', 'upperId', 'cursorId', 'page'])('IDLE with %s is CORRUPT', async (field) => {
  const world = await harness();
  const idle = await rawStateOf(world);
  idle[field] = sweepingState(idle)[field];
  await redis.set(world.key, JSON.stringify(idle));
  await refuseAll(world);
});

it.each(['NaN', 'Infinity', '-Infinity'])('a non-finite counter %s is CORRUPT', async (value) => {
  const world = await harness();
  const raw = JSON.stringify(sweepingState(await rawStateOf(world)));
  await redis.set(world.key, raw.replace('"overflowCount":2', `"overflowCount":${value}`));
  await refuseAll(world);
});

it.each([{}, []])('empty cjson collections %j survive an empty sweep', async (empty) => {
  const world = await harness();
  const raw = await rawStateOf(world);
  raw['retries'] = empty;
  await redis.set(world.key, JSON.stringify(raw));
  expect((await world.state.read(world.companyId)).value?.retries).toEqual({});
  const sweepId = ids.newId();
  const begun = await world.state.begin(world.fence, sweepId, null);
  expect(begun.code).toBe('OK');
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
  const stored = await rawStateOf(world);
  (stored['page'] as Record<string, unknown>)['entries'] = empty;
  await redis.set(world.key, JSON.stringify(stored));
  expect((await world.state.read(world.companyId)).value?.page?.entries).toEqual([]);
  const finished = await world.state.finish(
    { ...world.fence, expectedVersion: enrolled.version },
    sweepId,
  );
  expect(finished.code).toBe('OK');
  expect(finished.value?.phase).toBe('IDLE');
});

it('a missing historical sweep overflow counter retains its zero fallback', async () => {
  const world = await harness();
  const stored = sweepingState(await rawStateOf(world));
  delete stored['sweepOverflowCount'];
  stored['reconcileRequired'] = true;
  const page = stored['page'] as Record<string, unknown>;
  page['entries'] = [];
  page['exhausted'] = true;
  await redis.set(world.key, JSON.stringify(stored));
  const finished = await world.state.finish(world.fence, String(stored['sweepId']));
  expect(finished.code).toBe('OK');
  expect(finished.value?.reconcileRequired).toBe(false);
  expect(finished.value?.overflowCount).toBe(2);
  expect(finished.value?.overflowSince).toBe(0);
});

it('released ownership retains valid reservations and a takeover clears only their lease', async () => {
  const world = await harness();
  const sweepId = ids.newId();
  const begun = await world.state.begin(world.fence, sweepId, REQUEST_B);
  const workToken = ids.newId();
  const enrolled = await world.state.enrollPage(
    { ...world.fence, expectedVersion: begun.version },
    sweepId,
    null,
    ids.newId(),
    [{ requestId: REQUEST_A, workToken }],
    true,
    10,
  );
  const settled = await world.state.settlePage(
    { ...world.fence, expectedVersion: enrolled.version },
    enrolled.value?.page?.pageId ?? '',
    workToken,
    'RETRY',
  );
  const claimed = await world.state.reserveRetries(
    { ...world.fence, expectedVersion: settled.version },
    1,
    [ids.newId()],
  );
  expect(claimed.value?.reservations).toHaveLength(1);
  const released = await world.state.release({ ...world.fence, expectedVersion: claimed.version });
  expect(released.code).toBe('OK');
  expect(released.value?.ownerToken).toBeUndefined();
  expect(released.value?.retries[REQUEST_A]?.ownerToken).toBe(world.fence.ownerToken);
  const read = await world.state.read(world.companyId);
  expect(read.code).toBe('OK');
  expect(read.value?.page?.entries).toEqual([]);
  const taken = await world.state.acquire(world.companyId, ids.newId(), ids.newId());
  expect(taken.code).toBe('OK');
  expect(taken.value?.retries[REQUEST_A]?.ownerToken).toBeUndefined();
  expect(taken.value?.retries[REQUEST_A]?.ticket).toBe(settled.value?.retries[REQUEST_A]?.ticket);
});

it('expired timestamps remain readable and ownership can be taken over', async () => {
  const world = await harness();
  const raw = sweepingState(await rawStateOf(world));
  raw['leaseUntil'] = -1;
  raw['turnStartedAt'] = -2;
  await redis.set(world.key, JSON.stringify(raw));
  expect((await world.state.read(world.companyId)).code).toBe('OK');
  expect((await world.state.acquire(world.companyId, ids.newId(), ids.newId())).code).toBe('OK');
});

it('Lua preserves the existing version-cap LIMIT without writing', async () => {
  const world = await harness();
  const raw = await rawStateOf(world);
  raw['version'] = Number.MAX_SAFE_INTEGER;
  const stored = JSON.stringify(raw);
  await redis.set(world.key, stored);
  const reply = await redis.eval(
    RATING_CLAIM_STATE_SWEEP,
    1,
    world.key,
    JSON.stringify({
      companyId: world.companyId,
      incarnation: world.fence.incarnation,
      ownerToken: world.fence.ownerToken,
      version: Number.MAX_SAFE_INTEGER,
      action: 'begin',
      sweepId: ids.newId(),
      maxBytes: 1_048_576,
    }),
  );
  expect((JSON.parse(String(reply)) as { code: string }).code).toBe('LIMIT');
  expect(await redis.get(world.key)).toBe(stored);
});
