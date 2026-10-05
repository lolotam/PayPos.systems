import { randomBytes, randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { redisOtpRates } from './redis-otp-rates.ts';

let redis: Redis;
const prefix = `test:staff-otp:${randomBytes(8).toString('hex')}:`;
const syntheticKey = 'synthetic'.repeat(8),
  ip = '192.0.2.1',
  hash = Buffer.alloc(32, 11);
const clean = async () => {
  const keys = await redis.keys(`${prefix}*`);
  if (keys.length) await redis.del(...keys.map((k) => k.slice(prefix.length)));
};
function clockedRates(now: () => number) {
  // Keep real atomic Redis operations; replace only TIME's reply to test millisecond edges exactly.
  const clocked = new Proxy(redis, {
    get(target, key, receiver) {
      if (key !== 'eval') return Reflect.get(target, key, receiver);
      return (script: string, keyCount: number, ...args: (string | number)[]) => {
        const ms = now();
        return target.eval(
          script.replace("redis.call('TIME')", `{${Math.floor(ms / 1000)},${(ms % 1000) * 1000}}`),
          keyCount,
          ...args,
        );
      };
    },
  });
  return redisOtpRates(clocked, syntheticKey, { newId: randomUUID });
}
beforeAll(async () => {
  redis = new Redis(
    process.env['REDIS_URL'] ||
      `redis://:${encodeURIComponent(process.env['REDIS_PASSWORD'] ?? '')}@127.0.0.1:${process.env['REDIS_PORT'] ?? '6379'}`,
    { keyPrefix: prefix, enableOfflineQueue: false, maxRetriesPerRequest: 0 },
  );
  redis.on('error', () => undefined);
  await new Promise<void>((resolve, reject) => {
    redis.once('ready', resolve);
    redis.once('error', reject);
  });
});
beforeEach(clean);
afterAll(async () => {
  if (redis === undefined) return;
  await clean();
  await redis.quit();
});

describe('real Redis clock and shared atomic admission', () => {
  it('admits at precisely sixty seconds and precisely one rolling hour, never a millisecond before', async () => {
    let time = 1_700_000_000_000;
    const rates = clockedRates(() => time);
    expect(await rates.request(hash, ip, randomUUID())).toBe(0);
    time += 59_999;
    expect(await rates.request(hash, ip, randomUUID())).toBe(1);
    time++;
    expect(await rates.request(hash, ip, randomUUID())).toBe(0);
    await clean();
    const start = time;
    for (let i = 0; i < 5; i++) {
      time = start + i * 60_000;
      expect(await rates.request(hash, ip, randomUUID())).toBe(0);
    }
    time = start + 3_599_999;
    expect(await rates.request(hash, ip, randomUUID())).toBe(1);
    time++;
    expect(await rates.request(hash, ip, randomUUID())).toBe(0);
  });
  it('two API instances share the cooldown and reserve only once under concurrent requests', async () => {
    const one = redisOtpRates(redis, syntheticKey, { newId: randomUUID }),
      two = redisOtpRates(redis, syntheticKey, { newId: randomUUID });
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, i) => (i % 2 ? one : two).request(hash, ip, randomUUID())),
    );
    expect(results.filter((x) => x === 0)).toHaveLength(1);
    expect(results.filter((x) => x > 0).every((x) => x <= 60)).toBe(true);
    const keys = await redis.keys(`${prefix}*`);
    expect(keys.join(' ')).not.toContain(ip);
    for (const key of keys) {
      const name = key.slice(prefix.length);
      if (name.includes(':request:'))
        expect((await redis.zrange(name, '0', '-1')).join(' ')).not.toContain(ip);
    }
  });
  it('enforces five phone requests even after cooldown and twenty requests for a shared salon IP', async () => {
    const rates = redisOtpRates(redis, syntheticKey, { newId: randomUUID });
    for (let i = 0; i < 5; i++) {
      expect(await rates.request(hash, ip, randomUUID())).toBe(0);
      await redis.del(`staff-otp:cooldown:${hash.toString('hex')}`);
    }
    expect(await rates.request(hash, ip, randomUUID())).toBeGreaterThan(60);
    await clean();
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        rates.request(Buffer.alloc(32, i + 1), ip, randomUUID()),
      ),
    );
    expect(results.filter((x) => x === 0)).toHaveLength(20);
  });
});
describe('request rolling-hour pruning', () => {
  it('prunes expired rolling-hour entries and refuses entries still inside the window', async () => {
    const rates = redisOtpRates(redis, syntheticKey, { newId: randomUUID });
    const [seconds, microseconds] = await redis.time(),
      now = Number(seconds) * 1000 + Math.floor(Number(microseconds) / 1000);
    const key = `staff-otp:request:phone:${hash.toString('hex')}`;
    for (let i = 0; i < 5; i++) await redis.zadd(key, now - 3_600_000 + 1000, `synthetic-${i}`);
    expect(await rates.request(hash, ip, randomUUID())).toBeGreaterThan(0);
    for (let i = 0; i < 5; i++) await redis.zadd(key, now - 3_600_000 - 1000, `synthetic-${i}`);
    expect(await rates.request(hash, ip, randomUUID())).toBe(0);
  });
});

describe('verification limits do not trust a client phone or refund uncertain reservations', () => {
  it.each([true, false])('UUID case aliases share one quota (issued=%s)', async (issued) => {
    const rates = redisOtpRates(redis, syntheticKey, { newId: randomUUID });
    const proof = '00000000-0000-7000-8000-0000000000ab';
    if (issued) expect(await rates.request(hash, ip, proof)).toBe(0);
    for (let i = 0; i < 25; i++) expect(await rates.verify(proof, ip)).toBe(0);
    expect(await rates.verify(proof.toUpperCase(), '192.0.2.2')).toBeGreaterThan(0);
  });
  it('distinct proof handles for one requested phone share its quota without consulting identity', async () => {
    const rates = redisOtpRates(redis, syntheticKey, { newId: randomUUID });
    const first = randomUUID(),
      second = randomUUID();
    expect(await rates.request(hash, ip, first)).toBe(0);
    await redis.del(`staff-otp:cooldown:${hash.toString('hex')}`);
    expect(await rates.request(hash, ip, second)).toBe(0);
    for (let i = 0; i < 25; i++) expect(await rates.verify(i % 2 ? first : second, ip)).toBe(0);
    expect(await rates.verify(first, ip)).toBeGreaterThan(0);
    expect(await rates.verify(second, '192.0.2.2')).toBeGreaterThan(0);
    expect(await redis.get(`staff-otp:proof:${first}`)).toBe(hash.toString('hex'));
  });
  it('twenty-five reservations expire at the exact rolling-hour boundary', async () => {
    let time = 1_700_000_000_000;
    const rates = clockedRates(() => time);
    await rates.request(hash, ip, 'synthetic-proof');
    for (let i = 0; i < 25; i++) expect(await rates.verify('synthetic-proof', ip)).toBe(0);
    time += 3_599_999;
    expect(await rates.verify('synthetic-proof', ip)).toBe(1);
    time++;
    expect(await rates.verify('synthetic-proof', ip)).toBe(0);
  });
  it('concurrent verification cannot exceed twenty-five for one challenge phone', async () => {
    const rates = redisOtpRates(redis, syntheticKey, { newId: randomUUID });
    await rates.request(hash, ip, 'synthetic-proof');
    const results = await Promise.all(
      Array.from({ length: 40 }, () => rates.verify('synthetic-proof', ip)),
    );
    expect(results.filter((x) => x === 0)).toHaveLength(25);
    expect(await rates.verify('synthetic-proof', '192.0.2.2')).toBeGreaterThan(0);
  });
  it('absent challenge ids still consume exactly one hundred IP reservations', async () => {
    const rates = redisOtpRates(redis, syntheticKey, { newId: randomUUID });
    const results = await Promise.all(
      Array.from({ length: 120 }, () => rates.verify(randomUUID(), ip)),
    );
    expect(results.filter((x) => x === 0)).toHaveLength(100);
  });
});
