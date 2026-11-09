// C01/C03–C05/C08: كل الملاحظات ضد Redis الحقيقي؛ بلا محاكاة للتخزين.
import { systemUuidV7 } from '@pospay/ids';
import { expect, it } from 'vitest';

import { RATING_CLAIM_STATE_ACQUIRE as ACQUIRE } from '../rating-claim-state-acquire.lua.ts';
import { RATING_CLAIM_STATE_LEASE as LEASE } from '../rating-claim-state-lease.lua.ts';
import { RATING_CLAIM_STATE_RESERVE as RESERVE } from '../rating-claim-state-reserve.lua.ts';
import { RATING_CLAIM_STATE_SETTLE as SETTLE } from '../rating-claim-state-settle.lua.ts';
import { RATING_CLAIM_STATE_SWEEP as SWEEP } from '../rating-claim-state-sweep.lua.ts';
import { validationHarness, type ValidationWorld } from './rating-claim-state-harness.fixture.ts';
import {
  REQUEST_A as A,
  REQUEST_B as B,
  sweepingState,
} from './rating-claim-state-validation.fixture.ts';

const ids = systemUuidV7();
const MAX = Number.MAX_SAFE_INTEGER;
const HIGH = 100_000_000_000_001;
const { redis, harness, rawStateOf, refuseAll } = validationHarness();
const LIMITS = { leaseMs: 120_000, maxTurnMs: 180_000, maxBytes: 1_048_576 };
const BOUNDARIES = [
  1,
  2 ** 31 - 1,
  2 ** 31,
  2 ** 31 + 1,
  2 ** 32 - 1,
  2 ** 32,
  2 ** 32 + 1,
  10 ** 14 - 1,
  10 ** 14,
  10 ** 14 + 1,
  10 ** 15 - 1,
  10 ** 15,
  10 ** 15 + 1,
  2 ** 52 - 1,
  2 ** 52,
  2 ** 52 + 1,
  MAX - 1,
  MAX,
];

/** السور من النسخة الفعلية، مع احتفاظنا باختلافات fixtures الأصلية. */
async function seeded(patch: Record<string, unknown>, capacity = 2048) {
  const world = await harness({ capacity });
  const raw = { ...sweepingState(await rawStateOf(world)), ...patch };
  await redis.set(world.key, JSON.stringify(raw));
  return { world, raw, fence: { ...world.fence, expectedVersion: Number(raw['version']) } };
}

/** كل انتقال له رد، تخزين، رد خام، codec وقراءة تالية؛ السور يُستخدم في الانتقال التالي. */
async function checked(
  world: ValidationWorld,
  result: { code: string; version: number },
  version: number,
  code = 'OK',
) {
  expect(result).toMatchObject({ code, version });
  expect((await rawStateOf(world))['version']).toBe(version);
  const env = JSON.stringify({ companyId: world.companyId, action: 'read', ...LIMITS });
  expect(String(await redis.eval(LEASE, 1, world.key, env))).toContain(`"version":${version}`);
  const expected = { code: 'OK', version, value: { version } };
  expect(await world.state.read(world.companyId)).toMatchObject(expected);
}

it.each(BOUNDARIES)('version %d survives read, increment and next fence', async (version) => {
  const { world, fence } = await seeded({ version });
  const api = world.state;
  await checked(world, await api.read(world.companyId), version);
  const before = await redis.get(world.key);
  const renewed = await api.renew(fence);
  if (version === MAX) {
    expect(renewed).toEqual({ code: 'LIMIT', version });
    expect(await redis.get(world.key)).toBe(before);
  } else {
    expect(renewed.value?.version).toBe(version + 1);
    await checked(world, renewed, version + 1);
    const next = { ...fence, expectedVersion: version + 1 };
    const saved = await redis.get(world.key);
    const released = await api.release(next);
    if (version === MAX - 1) {
      expect(released).toEqual({ code: 'LIMIT', version: MAX });
      expect(await redis.get(world.key)).toBe(saved);
    } else await checked(world, released, version + 2);
  }
});

it.each([false, true])('owned/newly reserved retry success chain: %s', async (free) => {
  const patch = free ? { retries: { [A]: { ticket: 1, eligibleAt: 0 } } } : {};
  const { world, fence } = await seeded({ version: HIGH, ...patch });
  const api = world.state;
  const original = (await api.read(world.companyId)).value;
  const page = original?.page;
  let version = HIGH;
  let token = original?.retries[A]?.workToken ?? '';
  const next = () => ({ ...fence, expectedVersion: version });
  const reserve = async () => {
    const result = await api.reserveRetries(next(), 1, [ids.newId()]);
    expect(result.value?.reservations.map((entry) => entry.requestId)).toEqual(free ? [A] : []);
    if (free) token = result.value?.reservations[0]?.workToken ?? '';
    return result;
  };
  const commands = [
    () => api.renew(next()),
    reserve,
    () => api.settlePage(next(), page?.pageId ?? '', page?.entries[0]?.workToken ?? '', 'TERMINAL'),
    () => api.settleRetry(next(), A, token, 'TERMINAL'),
    () => api.release(next()),
    () => api.acquire(world.companyId, ids.newId(), ids.newId()),
  ];
  for (const command of commands) await checked(world, await command(), ++version);
});

it.each([false, true])('fresh/historical sweep setup: %s', async (historical) => {
  const world = await harness();
  const raw = historical ? sweepingState(await rawStateOf(world)) : await rawStateOf(world);
  Object.assign(raw, { version: HIGH, phase: 'IDLE' });
  for (const key of ['sweepId', 'upperId', 'cursorId', 'page']) Reflect.deleteProperty(raw, key);
  await redis.set(world.key, JSON.stringify(raw));
  const api = world.state;
  const sweep = ids.newId();
  let version = HIGH;
  const next = () => ({ ...world.fence, expectedVersion: version });
  const commands = [
    () => api.begin(next(), sweep, B),
    () => api.enrollPage(next(), sweep, null, ids.newId(), [], true, 10),
    () => api.finish(next(), sweep),
  ];
  for (const command of commands) await checked(world, await command(), ++version);
});

it('all ten commands and five raw script families keep exact no-write guards', async () => {
  const { world, fence } = await seeded({ version: HIGH });
  const api = world.state;
  const stale = { ...fence, expectedVersion: HIGH + 1 };
  const commands = [
    () => api.read(world.companyId),
    () => api.renew(stale),
    () => api.release(stale),
    () => api.begin(stale, 'sweep', B),
    () => api.enrollPage(stale, 'sweep', null, 'page', [], true, 10),
    () => api.finish(stale, 'sweep'),
    () => api.reserveRetries(stale, 1, ['work']),
    () => api.settlePage(stale, 'page', 'work', 'TERMINAL'),
    () => api.settleRetry(stale, A, 'work', 'TERMINAL'),
    () => api.acquire(world.companyId, ids.newId(), ids.newId()),
  ];
  const before = await redis.get(world.key);
  for (const [index, command] of commands.entries()) {
    const code = index === 0 ? 'OK' : index === 9 ? 'BUSY' : 'STALE';
    expect(await command()).toMatchObject({ code, version: HIGH });
    expect(await redis.get(world.key)).toBe(before);
  }
  for (const script of [ACQUIRE, LEASE, RESERVE, SETTLE, SWEEP]) {
    const env = JSON.stringify({ ...fence, version: HIGH + 1, action: 'renew', ...LIMITS });
    const raw = String(await redis.eval(script, 1, world.key, env));
    expect(raw).toContain(`"version":${HIGH}`);
    expect(JSON.parse(raw)).toMatchObject({ code: script === ACQUIRE ? 'BUSY' : 'STALE' });
    expect(await redis.get(world.key)).toBe(before);
  }
});

it.each([false, true])(
  'MAX overflow counters, first time and optional zero: %s',
  async (legacy) => {
    const { world, fence } = await seeded(
      {
        retries: {},
        overflowCount: MAX - 1,
        sweepOverflowCount: legacy ? undefined : MAX - 1,
        overflowSince: legacy ? undefined : -MAX,
      },
      0,
    );
    const api = world.state;
    const page = (await api.read(world.companyId)).value?.page;
    const result = await api.settlePage(
      fence,
      page?.pageId ?? '',
      page?.entries[0]?.workToken ?? '',
      'RETRY',
    );
    await checked(world, result, 2, 'OVERFLOW');
    expect(result.value).toMatchObject({ overflowCount: MAX, reconcileRequired: true });
    const stored = await rawStateOf(world);
    expect(stored['overflowCount']).toBe(MAX);
    expect(stored['sweepOverflowCount']).toBe(legacy ? 1 : MAX);
    if (legacy) expect(stored['overflowSince']).toBeGreaterThan(0);
    else expect(stored['overflowSince']).toBe(-MAX);
    const before = await redis.get(world.key);
    const next = { ...fence, expectedVersion: 2 };
    expect(
      await api.settlePage(next, page?.pageId ?? '', page?.entries[1]?.workToken ?? '', 'RETRY'),
    ).toEqual({ code: 'LIMIT', version: 2 });
    expect(await redis.get(world.key)).toBe(before);
  },
);

it.each([false, true])(
  'reverse tickets, owned/newly reserved allocation and refusal: %s',
  async (free) => {
    const { world, raw, fence } = await seeded({ nextTicket: MAX - 1 });
    const owned = (raw['retries'] as Record<string, Record<string, unknown>>)[A] ?? {};
    const ownership = free
      ? {}
      : { ownerToken: owned['ownerToken'], leaseUntil: owned['leaseUntil'] };
    const entry = (ticket: number, workToken: string) => ({
      ticket,
      eligibleAt: 0,
      ...ownership,
      ...(free ? {} : { workToken }),
    });
    raw['retries'] = { [B]: entry(MAX - 2, 'second'), [A]: entry(MAX - 3, 'first') };
    expect(Object.keys(raw['retries'] as object)).toEqual([B, A]);
    await redis.set(world.key, JSON.stringify(raw));
    const api = world.state;
    let version = 1;
    const next = () => ({ ...fence, expectedVersion: version });
    const reserve = async (id: string, token: string) => {
      const result = await api.reserveRetries(next(), 1, [token]);
      await checked(world, result, ++version);
      expect(result.value?.reservations.map((item) => item.requestId)).toEqual([id]);
    };
    if (free) await reserve(A, 'first');
    const read = await api.read(world.companyId);
    expect(read.value?.retries[A]?.ticket).toBe(MAX - 3);
    expect(read.value?.retries[B]?.ticket).toBe(MAX - 2);
    const result = await api.settleRetry(next(), A, 'first', 'RETRY');
    await checked(world, result, ++version);
    expect(result.value).toMatchObject({ nextTicket: MAX, retries: { [A]: { ticket: MAX - 1 } } });
    expect(await rawStateOf(world)).toMatchObject({
      nextTicket: MAX,
      retries: { [A]: { ticket: MAX - 1 }, [B]: { ticket: MAX - 2 } },
    });
    if (free) await reserve(B, 'second');
    const before = await redis.get(world.key);
    expect(await api.settleRetry(next(), B, 'second', 'RETRY')).toEqual({ code: 'LIMIT', version });
    expect(await redis.get(world.key)).toBe(before);
  },
);

it.each([0.5, -1, MAX + 1, '1', null])(
  'invalid version %s keeps original bytes',
  async (version) => {
    const { world } = await seeded({ version });
    await refuseAll(world);
  },
);
