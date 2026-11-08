// C02/C06/C07/C09: كامل العدّادات والأوقات، توافق JSON، وحدود cjson الفعلية.
import { expect, it } from 'vitest';

import { RATING_CLAIM_STATE_LEASE as LEASE } from '../rating-claim-state-lease.lua.ts';
import { validationHarness } from './rating-claim-state-harness.fixture.ts';
import { REQUEST_A as A, sweepingState } from './rating-claim-state-validation.fixture.ts';

const MAX = Number.MAX_SAFE_INTEGER;
const COUNTERS = [
  1,
  2 ** 31 - 1,
  2 ** 31,
  2 ** 32,
  10 ** 14 + 1,
  10 ** 15 + 1,
  2 ** 52,
  MAX - 1,
  MAX,
];
const MOMENTS = [-MAX, -1, 0, 1, MAX - 1, MAX];
const { redis, harness, rawStateOf } = validationHarness();
const LIMITS = { leaseMs: 120_000, maxTurnMs: 180_000, maxBytes: 1_048_576 };
const PROBE = [
  'local ok, v = pcall(cjson.decode, ARGV[1]); if not ok then return 0 end',
  "if ARGV[2] == 'reply' then v = { code = 'OK', version = 1, value = v } end",
  'if pcall(cjson.encode, v) then return 1 end; return 2',
].join(' ');

/** كتابة فعلية تلي القراءة؛ تثبت أن القيم لم تكن مجرد fixture محفوظة. */
async function roundTrip(patch: Record<string, unknown>, expected = patch, reserve = false) {
  const world = await harness();
  const raw = { ...sweepingState(await rawStateOf(world)), ...patch };
  await redis.set(world.key, JSON.stringify(raw));
  const read = await world.state.read(world.companyId);
  expect(read.code).toBe('OK');
  const result = reserve
    ? await world.state.reserveRetries(world.fence, 1, ['work'])
    : await world.state.renew(world.fence);
  expect(result).toMatchObject({ code: 'OK', version: 2 });
  const reservations = [{ requestId: A, workToken: 'work' }];
  expect(result.value).toMatchObject(reserve ? { reservations } : expected);
  const env = JSON.stringify({ companyId: world.companyId, action: 'read', ...LIMITS });
  const reply = String(await redis.eval(LEASE, 1, world.key, env));
  const stored = await rawStateOf(world);
  for (const layer of [read.value, stored, JSON.parse(reply).value]) {
    expect(layer).toMatchObject(expected);
  }
  const snapshot = { code: 'OK', version: 2, value: expected };
  expect(await world.state.read(world.companyId)).toMatchObject(snapshot);
  const next = { ...world.fence, expectedVersion: 2 };
  expect(await world.state.release(next)).toMatchObject({ code: 'OK', version: 3 });
  return { reply, stored, key: world.key };
}

it.each(COUNTERS)('counter inventory %d survives a real write and next fence', async (value) => {
  const ticket = Math.min(value, MAX - 1);
  const patch = {
    nextTicket: MAX,
    overflowCount: value,
    sweepOverflowCount: value,
    reconcileRequired: true,
    retries: { [A]: { ticket, eligibleAt: 0 } },
  };
  const observed = await roundTrip(patch, patch, true);
  for (const field of ['nextTicket', 'overflowCount', 'sweepOverflowCount'] as const) {
    expect(observed.reply).toContain(`"${field}":${patch[field]}`);
  }
  expect(observed.reply).toContain(`"ticket":${ticket}`);
  const next = await roundTrip({ nextTicket: value, retries: {} });
  expect(next.reply).toContain(`"nextTicket":${value}`);
});

it.each(MOMENTS)(
  'signed retry and overflow times %d survive an unrelated write',
  async (moment) => {
    const owner = { ownerToken: 'retry-owner', workToken: 'retry-work', leaseUntil: moment };
    const patch = {
      overflowSince: moment,
      retries: { [A]: { ticket: 1, eligibleAt: moment, ...owner } },
    };
    const observed = await roundTrip(patch);
    for (const field of ['overflowSince', 'eligibleAt', 'leaseUntil']) {
      expect(observed.reply).toContain(`"${field}":${moment}`);
    }
  },
);

it.each(MOMENTS)('signed owner times %d retain refusal/takeover or release', async (moment) => {
  const world = await harness();
  const times = { leaseUntil: moment, turnStartedAt: moment };
  const raw = { ...sweepingState(await rawStateOf(world)), ...times };
  const text = JSON.stringify(raw);
  await redis.set(world.key, text);
  const env = JSON.stringify({ companyId: world.companyId, action: 'read', ...LIMITS });
  const reply = String(await redis.eval(LEASE, 1, world.key, env));
  expect(reply).toContain(`"leaseUntil":${moment}`);
  expect(reply).toContain(`"turnStartedAt":${moment}`);
  expect((await world.state.read(world.companyId)).value).toMatchObject(times);
  expect(await redis.get(world.key)).toBe(text);
  const released = await world.state.release(world.fence);
  if (moment <= 1) {
    expect(released).toEqual({ code: 'BUSY', version: 1 });
    expect(await redis.get(world.key)).toBe(text);
    const taken = await world.state.acquire(world.companyId, 'unused-incarnation', 'new-owner');
    expect(taken).toMatchObject({ code: 'OK', version: 2 });
    expect((await rawStateOf(world))['leaseUntil']).toBeGreaterThan(0);
    expect((await rawStateOf(world))['ownerToken']).toBe('new-owner');
  } else {
    expect(released).toMatchObject({ code: 'OK', version: 2 });
    expect((await rawStateOf(world))['leaseUntil']).toBeUndefined();
    expect((await rawStateOf(world))['turnStartedAt']).toBeUndefined();
  }
  expect(await world.state.read(world.companyId)).toMatchObject({ code: 'OK', version: 2 });
});

const ESCAPED = String.fromCharCode(...[...Array(32).keys()], 34, 47, 92, 127);
it.each([...ESCAPED])('isolated escape %j and compatibility samples', async (escape) => {
  const patch = {
    overflowSince: -MAX,
    note: `مرحبا "بكم" \\Slash${escape}`,
    text: `مرحبا "بكم" \\Slash${escape}`,
    'quoted"key': 'a\\b',
    'escaped"key': 'a\\b',
    numericString: '1',
    numericKey: '1',
    nothing: null,
    empty: [],
    emptyObject: {},
    emptyArray: [],
    numbers: { '1': 1, '2': 2 },
    mixed: [1, 'two', null, { deep: true }],
    deep: { a: { b: { c: [1, 'two', null, { d: true }] } } },
    nested: { a: { b: { c: [1, 2, { d: 'e' }] } } },
    [escape]: escape,
  };
  const observed = await roundTrip(patch, { ...patch, empty: {}, emptyArray: {} });
  expect(observed.reply).toContain('-9007199254740991');
  expect(observed.reply).toContain('"quoted\\"key"');
  expect(observed.reply).toContain('"escaped\\"key"');
  expect(observed.reply).toContain('"numericKey":"1"');
  expect(observed.reply).toContain('مرحبا');
  const oracle = String(await redis.eval('return cjson.encode(ARGV[1])', 0, escape));
  expect(observed.reply).toContain(`${oracle}:${oracle}`);
  expect(String(await redis.get(observed.key))).toContain(`${oracle}:${oracle}`);
});

/** أعلى حد فعلي؛ لا نفترض أن حد decode يساوي حد encode. */
async function maxDepth(works: (depth: number) => Promise<boolean>) {
  let low = 0;
  let high = 4096;
  while (low < high) {
    const middle = Math.floor((low + high + 1) / 2);
    if (await works(middle)) low = middle;
    else high = middle - 1;
  }
  return low;
}

it('cjson shallow control, state depth and reply wrapper accept/reject the same boundaries', async () => {
  const world = await harness();
  const base = sweepingState(await rawStateOf(world));
  const textOf = (depth: number) => {
    let value: unknown = 'deepest-marker';
    for (let level = 0; level < depth; level += 1) value = { nested: value };
    return JSON.stringify({ ...base, unknown: value });
  };
  const probe = async (depth: number, shape: string) =>
    Number(await redis.eval(PROBE, 0, textOf(depth), shape));
  expect(await probe(0, 'state')).toBe(1);
  expect(await probe(0, 'reply')).toBe(1);
  const stateDepth = await maxDepth(async (depth) => (await probe(depth, 'state')) === 1);
  const replyDepth = await maxDepth(async (depth) => (await probe(depth, 'reply')) === 1);
  expect(stateDepth).toBeGreaterThan(replyDepth);
  expect(await probe(stateDepth, 'state')).toBe(1);
  expect(await probe(stateDepth + 1, 'state')).not.toBe(1);
  for (const depth of [replyDepth, replyDepth + 1, stateDepth + 1]) {
    const text = textOf(depth);
    await redis.set(world.key, text);
    const oracle = await probe(depth, 'reply');
    const result = world.state.read(world.companyId);
    if (depth === replyDepth) {
      expect(await result).toMatchObject({ code: 'OK' });
    } else if (oracle === 0) {
      expect(await result).toMatchObject({ code: 'CORRUPT' });
    } else await expect(result).rejects.toThrow('Cannot serialise');
    expect(await redis.get(world.key)).toBe(text);
  }
});
