import type { Redis } from 'ioredis';
import { describe, expect, it } from 'vitest';

import { createRedisRateLimiter } from '../adapters/redis-rate-limiter.ts';
import { RateLimiterUnavailableError } from '../ports/rate-limiter.port.ts';

const LIMIT = 3;
const WINDOW = 60;

/** The commands the pipeline issued, so a test can see what Redis was asked to do. */
type PipelineCall = {
  readonly command: 'INCR' | 'EXPIRE';
  readonly key: string;
  readonly mode?: string;
  readonly seconds?: number;
};

type FakePipeline = {
  incr(key: string): FakePipeline;
  expire(key: string, seconds: number, mode: string): FakePipeline;
  exec(): Promise<unknown>;
};

type StoreWrite = { readonly key: string; readonly mode: string; readonly seconds: number };

/**
 * A Redis whose EXEC answers with the given reply, so the adapter's own validation is what the
 * test exercises — no server, no network, no waiting.
 */
function fakeRedis(reply: unknown, calls: PipelineCall[] = []): Redis {
  const pipeline: FakePipeline = {
    incr(key) {
      calls.push({ command: 'INCR', key });
      return pipeline;
    },
    expire(key, seconds, mode) {
      calls.push({ command: 'EXPIRE', key, mode, seconds });
      return pipeline;
    },
    exec: () => Promise.resolve(reply),
  };
  return { multi: () => pipeline } as unknown as Redis;
}

/** A Redis whose EXEC rejects, the way a lost connection does. */
function rejectingRedis(failure: unknown): Redis {
  const pipeline: FakePipeline = {
    incr: () => pipeline,
    expire: () => pipeline,
    exec: () => Promise.reject(failure),
  };
  return { multi: () => pipeline } as unknown as Redis;
}

/** A Redis for the plain key-value calls the other limiter methods make. */
function fakeStore(
  values: Record<string, string>,
  writes: StoreWrite[],
  ttl: (key: string) => number,
): Redis {
  return {
    set: (key: string, value: string, mode: string, seconds: number) => {
      writes.push({ key, mode, seconds });
      values[key] = value;
      return Promise.resolve('OK');
    },
    get: (key: string) => Promise.resolve(values[key] ?? null),
    ttl: (key: string) => Promise.resolve(ttl(key)),
  } as unknown as Redis;
}

const COUNT_CASES: [string, number, boolean][] = [
  ['below the limit', 1, true],
  ['exactly at the limit', 3, true],
  ['above the limit', 4, false],
];

const ENVELOPE_CASES: [string, unknown][] = [
  ['a null reply, as an aborted pipeline answers', null],
  ['a missing reply', undefined],
  ['a reply that is not an array', 'INCR'],
  ['a reply with no command results', []],
  ['a reply with one command result', [[null, 1]]],
  [
    'a reply with three command results',
    [
      [null, 1],
      [null, 1],
      [null, 1],
    ],
  ],
  ['a command result that is not a tuple', [[null, 1], null]],
  ['a command tuple with one entry', [[null], [null, 1]]],
  [
    'a command tuple with three entries',
    [
      [null, 1, 1],
      [null, 1],
    ],
  ],
];

const COMMAND_ERROR_CASES: [string, unknown][] = [
  [
    'an INCR error',
    [
      [new Error('ERR INCR'), null],
      [null, 1],
    ],
  ],
  [
    'an EXPIRE error after a successful INCR',
    [
      [null, 1],
      [new Error('ERR EXPIRE'), null],
    ],
  ],
  [
    'errors in both commands',
    [
      [new Error('ERR INCR'), null],
      [new Error('ERR EXPIRE'), null],
    ],
  ],
];

const INVALID_COUNT_CASES: [string, unknown][] = [
  ['a null count', null],
  ['a missing count', undefined],
  ['a zero count', 0],
  ['a negative count', -1],
  ['a fractional count', 1.5],
  ['a count that is not a number', '1'],
  ['a count that is not finite', Number.POSITIVE_INFINITY],
  ['a count that is not a number at all', Number.NaN],
  ['a count beyond the safe integer range', Number.MAX_SAFE_INTEGER + 1],
];

const INVALID_EXPIRY_CASES: [string, unknown][] = [
  ['a null expiry result', null],
  ['a missing expiry result', undefined],
  ['an expiry result of two', 2],
  ['a negative expiry result', -1],
  ['a fractional expiry result', 1.5],
  ['an expiry result that is a string', '1'],
  ['an expiry result that is not finite', Number.POSITIVE_INFINITY],
];

describe('the shared Redis rate limiter counts inside the window', () => {
  it.each(COUNT_CASES)('counts %s as %s', async (_name: string, count: number, ok: boolean) => {
    const limiter = createRedisRateLimiter(
      fakeRedis([
        [null, count],
        [null, 1],
      ]),
    );
    await expect(limiter.hit('key-1', LIMIT, WINDOW)).resolves.toBe(ok);
  });

  it('accepts an EXPIRE NX that left the TTL alone because the key already had one', async () => {
    const limiter = createRedisRateLimiter(
      fakeRedis([
        [null, 1],
        [null, 0],
      ]),
    );
    await expect(limiter.hit('key-1', LIMIT, WINDOW)).resolves.toBe(true);
  });

  it('accepts an EXPIRE NX that set the TTL', async () => {
    const limiter = createRedisRateLimiter(
      fakeRedis([
        [null, 1],
        [null, 1],
      ]),
    );
    await expect(limiter.hit('key-1', LIMIT, WINDOW)).resolves.toBe(true);
  });

  it('counts the attempt and sets the window expiry on the same key', async () => {
    const calls: PipelineCall[] = [];
    const limiter = createRedisRateLimiter(
      fakeRedis(
        [
          [null, 1],
          [null, 1],
        ],
        calls,
      ),
    );
    await limiter.hit('key-1', LIMIT, WINDOW);
    expect(calls.map((call) => call.command)).toEqual(['INCR', 'EXPIRE']);
    expect(calls[0]?.key).toBe(calls[1]?.key);
    expect(calls[1]?.mode).toBe('NX');
  });
});

describe('the shared Redis rate limiter refuses a reply it cannot count', () => {
  it.each(ENVELOPE_CASES)('rejects %s', async (_name: string, reply: unknown) => {
    const limiter = createRedisRateLimiter(fakeRedis(reply));
    await expect(limiter.hit('key-1', LIMIT, WINDOW)).rejects.toBeInstanceOf(
      RateLimiterUnavailableError,
    );
  });

  it.each(COMMAND_ERROR_CASES)('rejects %s', async (_name: string, reply: unknown) => {
    const limiter = createRedisRateLimiter(fakeRedis(reply));
    await expect(limiter.hit('key-1', LIMIT, WINDOW)).rejects.toBeInstanceOf(
      RateLimiterUnavailableError,
    );
  });

  it.each(INVALID_COUNT_CASES)('rejects %s', async (_name: string, count: unknown) => {
    const limiter = createRedisRateLimiter(
      fakeRedis([
        [null, count],
        [null, 1],
      ]),
    );
    await expect(limiter.hit('key-1', LIMIT, WINDOW)).rejects.toBeInstanceOf(
      RateLimiterUnavailableError,
    );
  });

  it.each(INVALID_EXPIRY_CASES)('rejects %s', async (_name: string, expiry: unknown) => {
    const limiter = createRedisRateLimiter(
      fakeRedis([
        [null, 1],
        [null, expiry],
      ]),
    );
    await expect(limiter.hit('key-1', LIMIT, WINDOW)).rejects.toBeInstanceOf(
      RateLimiterUnavailableError,
    );
  });
});

describe('the shared Redis rate limiter keeps its failures free of Redis contents', () => {
  it('keeps the original transport failure as it is', async () => {
    const failure = new Error('redis connection closed');
    const limiter = createRedisRateLimiter(rejectingRedis(failure));
    const thrown = await limiter.hit('key-1', LIMIT, WINDOW).catch((error: unknown) => error);
    expect(thrown).toBe(failure);
    expect(thrown).not.toBeInstanceOf(RateLimiterUnavailableError);
  });

  it('reports an unusable reply with a constant message and no Redis contents', async () => {
    const limiter = createRedisRateLimiter(
      fakeRedis([
        [new Error('ERR unknown command tok_live_secret'), null],
        [null, 1],
      ]),
    );
    const thrown = await limiter
      .hit('rate:secret-key-42', LIMIT, WINDOW)
      .catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(RateLimiterUnavailableError);
    const failure = thrown as Error;
    expect(failure.message).toBe('RATE_LIMITER_UNAVAILABLE');
    expect(failure.message).not.toContain('tok_live_secret');
    expect(failure.message).not.toContain('secret-key-42');
    expect(failure.cause).toBeUndefined();
  });
});

describe('the other limiter methods keep their behaviour', () => {
  it('remembers, reads back, counts and reports the remaining seconds', async () => {
    const values: Record<string, string> = { 'rate:counter': '7' };
    const writes: StoreWrite[] = [];
    const limiter = createRedisRateLimiter(fakeStore(values, writes, () => 30));
    await limiter.remember('done-key', 90);
    expect(writes).toEqual([{ key: 'rate:done:done-key', mode: 'EX', seconds: 90 }]);
    await expect(limiter.remembered('done-key')).resolves.toBe(true);
    await expect(limiter.count('counter')).resolves.toBe(7);
    await expect(limiter.remaining('counter')).resolves.toBe(30);
  });
});

const INVALID_TTL_CASES: [string, unknown][] = [
  ['a TTL of -3', -3],
  ['a TTL of -4', -4],
  ['a fractional TTL', 1.5],
  ['a TTL that is a string', '30'],
  ['a null TTL', null],
  ['a missing TTL', undefined],
  ['a TTL that is not finite', Number.POSITIVE_INFINITY],
];

describe('the shared Redis rate limiter reads the remaining seconds only from a reply it trusts', () => {
  it.each(INVALID_TTL_CASES)('rejects %s', async (_name: string, ttl: unknown) => {
    const limiter = createRedisRateLimiter(fakeStore({}, [], () => ttl as number));
    await expect(limiter.remaining('counter')).rejects.toBeInstanceOf(RateLimiterUnavailableError);
  });

  it.each([
    ['a key with no expiry left', -1, 0],
    ['a key that is gone', -2, 0],
    ['a live key', 30, 30],
    ['a key about to expire', 1, 1],
  ] as const)('reads %s as %s', async (_name: string, ttl: number, expected: number) => {
    const limiter = createRedisRateLimiter(fakeStore({}, [], () => ttl));
    await expect(limiter.remaining('counter')).resolves.toBe(expected);
  });
});
