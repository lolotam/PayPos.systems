import { expect, it } from 'vitest';

import { RATING_CLAIM_STATE_LEASE } from '../rating-claim-state-lease.lua.ts';
import { RATING_CLAIM_STATE_VALIDATE } from '../rating-claim-state-validate.lua.ts';
import { redisRatingClaimState } from '../redis-rating-claim-state.ts';
import { validationHarness } from './rating-claim-state-harness.fixture.ts';

const { redis, harness, rawStateOf } = validationHarness();
const MAX = Number.MAX_SAFE_INTEGER;
const BOUNDARY = 100_000_000_000_000;
const LIMITS = { leaseMs: 120_000, maxTurnMs: 180_000, maxBytes: 1_048_576 };
const BOUNDARIES = [0, BOUNDARY - 1, BOUNDARY, BOUNDARY + 1, MAX].flatMap((value) =>
  value === 0 ? [value] : [value, -value],
);

/** المقارنة على نفس قيمة Lua؛ لا نفترض ترتيبًا ثابتًا لمفاتيح الكائنات. */
async function probe(expression: string, input = 'null') {
  const script = `
local MAX_SAFE = 9007199254740991
${RATING_CLAIM_STATE_VALIDATE}
local value = ${expression}
local nativeOk, native = pcall(cjson.encode, value)
local exactOk, exact = pcall(exact_json, value)
return cjson.encode({ nativeOk = nativeOk, exactOk = exactOk,
  native = native, exact = exact, zero = string.format('%.0f', -0.0) })
`;
  return JSON.parse(String(await redis.eval(script, 0, input))) as {
    nativeOk: boolean;
    exactOk: boolean;
    native: string;
    exact: string;
    zero: string;
  };
}

it.each(BOUNDARIES)('exact scalar and native precision boundary: %s', async (value) => {
  const observed = await probe('cjson.decode(ARGV[1])', JSON.stringify(value));
  expect(observed.nativeOk).toBe(true);
  expect(observed.exactOk).toBe(true);
  expect(observed.exact).toBe(String(value));
  expect(JSON.parse(observed.exact)).toBe(value);
  if (Math.abs(value) < BOUNDARY) expect(observed.native).toBe(observed.exact);
  if (Math.abs(value) === BOUNDARY + 1) {
    expect(JSON.parse(observed.native)).not.toBe(value);
  }
});

it.each([1, -1, 10 ** 12, 10 ** 13])(
  'native zero/scientific-format eligibility control: %s',
  async (value) => {
    const observed = await probe('cjson.decode(ARGV[1])', JSON.stringify(value));
    expect(observed.nativeOk).toBe(true);
    expect(observed.exactOk).toBe(true);
    expect(observed.native).toBe(String(value));
    expect(observed.exact).toBe(observed.native);
  },
);

it('ordinary whole-tree compatibility includes zero without a high-integer fallback trigger', async () => {
  const value = {
    zero: 0,
    clock: 1_800_000_000_001,
    text: 'مرحبا 🌟 "quoted" / \\ end',
    controls: String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i), 127),
    'escaped"key/\\': '12345678901234567890',
    nested: { numericKeys: { '1': 'one', '2': 'two' }, array: [0, true, false, null, 'x'] },
    emptyArray: [],
    emptyObject: {},
  };
  const observed = await probe('cjson.decode(ARGV[1])', JSON.stringify(value));
  const expected = { ...value, emptyArray: {} };
  expect(observed.nativeOk).toBe(true);
  expect(observed.exactOk).toBe(true);
  expect(JSON.parse(observed.native)).toEqual(expected);
  expect(JSON.parse(observed.exact)).toEqual(expected);
  expect(Buffer.byteLength(observed.exact)).toBe(Buffer.byteLength(observed.native));
});

it.each([0.125, -0.125, 1e-7, MAX + 1])(
  'fractional/scientific/unsafe fallback retains cjson behavior: %s',
  async (value) => {
    const observed = await probe('cjson.decode(ARGV[1])', JSON.stringify(value));
    expect(observed.nativeOk).toBe(true);
    expect(observed.exactOk).toBe(true);
    expect(observed.exact).toBe(observed.native);
  },
);

it('negative zero retains the existing exact decimal rendering; ordinary zero remains native-compatible', async () => {
  const negative = await probe('-0.0');
  expect(negative.nativeOk).toBe(true);
  expect(negative.exactOk).toBe(true);
  expect(negative.exact).toBe(negative.zero);
  const ordinary = await probe('0');
  expect(ordinary.nativeOk).toBe(true);
  expect(ordinary.exactOk).toBe(true);
  expect(ordinary.exact).toBe('0');
  expect(ordinary.native).toBe('0');
});

it.each([
  { name: 'dense', expression: '{ "one", "two" }', expected: ['one', 'two'] },
  { name: 'empty', expression: '{}', expected: {} },
  {
    name: 'mixed',
    expression: '{ [1] = "one", label = "mixed" }',
    expected: { '1': 'one', label: 'mixed' },
  },
  {
    name: 'sparse',
    expression: '{ [1] = "one", [3] = "three" }',
    expected: { '1': 'one', '3': 'three' },
  },
  {
    name: 'nested sparse',
    expression: '{ nested = { [1] = "one", [3] = "three" } }',
    expected: { nested: { '1': 'one', '3': 'three' } },
  },
  {
    name: 'fractional key',
    expression: '{ [1.5] = "fraction" }',
    expected: { '1.5': 'fraction' },
  },
])('Lua $name container preserves existing shape', async ({ expression, expected }) => {
  const observed = await probe(expression);
  expect(observed.nativeOk).toBe(true);
  expect(observed.exactOk).toBe(true);
  expect(JSON.parse(observed.exact)).toEqual(expected);
});

it.each(['{ [true] = "invalid-key" }', '{ value = math.huge }', '{ value = 0 / 0 }'])(
  'cjson admission still rejects unsupported input: %s',
  async (expression) => {
    const observed = await probe(expression);
    expect(observed.nativeOk).toBe(false);
    expect(observed.exactOk).toBe(false);
  },
);

it.each(['object', 'array'] as const)(
  'nested unknown MAX integers survive stored/reply/follow-up fences in an %s',
  async (shape) => {
    const world = await harness();
    const raw = await rawStateOf(world);
    const payload = { positive: MAX, negative: -MAX, numericText: String(MAX) };
    const unknown = shape === 'object' ? { deeper: { payload } } : [{ deeper: [payload] }];
    await redis.set(world.key, JSON.stringify({ ...raw, unknown }));
    const read = await world.state.read(world.companyId);
    expect(read.value).toMatchObject({ version: 1, unknown });
    const renewed = await world.state.renew(world.fence);
    expect(renewed).toMatchObject({ code: 'OK', version: 2, value: { unknown } });
    const stored = await redis.get(world.key);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored ?? '')).toMatchObject({ version: 2, unknown });
    expect(stored).toContain(`"positive":${MAX}`);
    expect(stored).toContain(`"negative":${-MAX}`);
    const reply = String(
      await redis.eval(
        RATING_CLAIM_STATE_LEASE,
        1,
        world.key,
        JSON.stringify({ companyId: world.companyId, action: 'read', ...LIMITS }),
      ),
    );
    expect(JSON.parse(reply)).toMatchObject({ code: 'OK', version: 2, value: { unknown } });
    expect(reply).toContain(`"positive":${MAX}`);
    expect(reply).toContain(`"negative":${-MAX}`);
    const released = await world.state.release({ ...world.fence, expectedVersion: 2 });
    expect(released).toMatchObject({ code: 'OK', version: 3, value: { unknown } });
    const before = await redis.get(world.key);
    expect(await world.state.renew(world.fence)).toEqual({ code: 'STALE', version: 3 });
    expect(await redis.get(world.key)).toBe(before);
  },
);

it('ordinary eligible state honors the exact UTF-8 byte cap and refusal preserves its fence', async () => {
  const world = await harness();
  const raw = {
    ...(await rawStateOf(world)),
    unknown: { zero: 0, note: 'مرحبا 🌟', count: 1 },
  };
  const expected = { ...raw, version: 2 } as Record<string, unknown>;
  delete expected['ownerToken'];
  delete expected['leaseUntil'];
  delete expected['turnStartedAt'];
  const bytes = Buffer.byteLength(JSON.stringify(expected));
  await redis.set(world.key, JSON.stringify(raw));
  const limited = (maxBytes: number) =>
    redisRatingClaimState({ prefix: world.prefix, redis, maxBytes, reserveBytes: 0 });
  const before = await redis.get(world.key);
  expect(await limited(bytes - 1).release(world.fence)).toEqual({ code: 'LIMIT', version: 1 });
  expect(await redis.get(world.key)).toBe(before);
  const accepted = await limited(bytes).release(world.fence);
  expect(accepted).toMatchObject({ code: 'OK', version: 2, value: expected });
  const stored = await redis.get(world.key);
  expect(Buffer.byteLength(stored ?? '')).toBe(bytes);
  expect(JSON.parse(stored ?? '')).toEqual(expected);
  expect(await world.state.read(world.companyId)).toMatchObject({
    code: 'OK',
    version: 2,
    value: expected,
  });
  expect(await limited(bytes).release(world.fence)).toEqual({ code: 'STALE', version: 2 });
  expect(await redis.get(world.key)).toBe(stored);
});
