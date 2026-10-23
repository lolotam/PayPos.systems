import type { Redis } from 'ioredis';
import { expect, it } from 'vitest';

import { redisPushAdmission } from '../persistence/redis-push-admission.ts';

const SUBSCRIPTION = '01920000-0000-7000-8000-0000000000c1';
const OTHER = '01920000-0000-7000-8000-0000000000c2';

interface FakeRedis {
  readonly redis: Pick<Redis, 'eval'>;
  readonly advance: (ms: number) => void;
}

// Redis وهمي: عدّاد نافذة ثابتة في الذاكرة، بمعنى INCR وPEXPIRE.
function fakeRedis(): FakeRedis {
  const store = new Map<string, { count: number; expiresAt: number }>();
  let now = 0;
  const eval = async (
    _script: string,
    _numkeys: number,
    ...args: (string | number | Buffer)[]
  ): Promise<number> => {
    const key = String(args[0]);
    const limit = Number(args[1]);
    const windowMs = Number(args[2]);
    const entry = store.get(key);
    if (entry === undefined || entry.expiresAt <= now) {
      store.set(key, { count: 1, expiresAt: now + windowMs });
      return 1;
    }
    entry.count += 1;
    return entry.count <= limit ? 1 : 0;
  };
  return {
    redis: { eval } as unknown as Pick<Redis, 'eval'>,
    advance: (ms) => {
      now += ms;
    },
  };
}

function failingRedis(): Pick<Redis, 'eval'> {
  return {
    eval: (async () => {
      throw new Error('redis://user:secret-password@host:6379 is down');
    }) as unknown as Pick<Redis, 'eval'>['eval'],
  };
}

it('allows ten sends a minute for one subscription and refuses the eleventh', async () => {
  const admission = redisPushAdmission(fakeRedis().redis);
  for (let attempt = 0; attempt < 10; attempt += 1)
    expect(await admission.reserve(SUBSCRIPTION), `attempt ${attempt}`).toBe(true);
  expect(await admission.reserve(SUBSCRIPTION)).toBe(false);
});

it('counts every subscription on its own budget', async () => {
  const admission = redisPushAdmission(fakeRedis().redis);
  for (let attempt = 0; attempt < 10; attempt += 1) await admission.reserve(SUBSCRIPTION);
  expect(await admission.reserve(SUBSCRIPTION)).toBe(false);
  expect(await admission.reserve(OTHER)).toBe(true);
});

it('allows the subscription again after the window passed', async () => {
  const fake = fakeRedis();
  const admission = redisPushAdmission(fake.redis, { limit: 2, windowMs: 1000 });
  expect(await admission.reserve(SUBSCRIPTION)).toBe(true);
  expect(await admission.reserve(SUBSCRIPTION)).toBe(true);
  expect(await admission.reserve(SUBSCRIPTION)).toBe(false);
  fake.advance(1001);
  expect(await admission.reserve(SUBSCRIPTION)).toBe(true);
});

it('refuses a configuration that is not a positive whole number', () => {
  for (const options of [
    { limit: 0 },
    { limit: -1 },
    { limit: 1.5 },
    { windowMs: 0 },
    { windowMs: -1 },
    { windowMs: 1.5 },
  ])
    expect(() => redisPushAdmission(fakeRedis().redis, options), JSON.stringify(options)).toThrow(
      'PUSH_ADMISSION_CONFIG_INVALID',
    );
});

it('hides the redis failure behind a bounded reason', async () => {
  const admission = redisPushAdmission(failingRedis());
  let message = '';
  try {
    await admission.reserve(SUBSCRIPTION);
  } catch (error) {
    message = (error as Error).message;
  }
  expect(message).toBe('PUSH_ADMISSION_UNAVAILABLE');
  expect(message).not.toContain('secret-password');
});
