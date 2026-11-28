import { randomBytes, randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

import type { ApproverPinDevice, DevicePinCap } from '../ports/discount-approver-pin.port.ts';
import { requireRedisUrl, testRedis } from '../../../../test/harness.ts';
import { createRedisDevicePinCap } from './redis-device-pin-cap.ts';

let redis: Redis | undefined;
let scanner: Redis | undefined;
let setupReady = false;
let cap: DevicePinCap;
const prefix = `test:device-pin:${randomBytes(8).toString('hex')}:`;
const device: ApproverPinDevice = {
  companyId: 'synthetic-company',
  deviceId: 'synthetic-device',
  branchId: 'synthetic-branch',
};

const clean = async () => {
  if (scanner === undefined) throw new Error('redis scanner not initialized');
  // Scan and delete via an unprefixed client so keyPrefix is never applied twice (#1011).
  let cursor = '0';
  do {
    const [next, keys] = await scanner.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 100);
    cursor = next;
    if (keys.length > 0) await scanner.del(...keys);
  } while (cursor !== '0');
};

async function closeClient(client: Redis | undefined): Promise<void> {
  if (client === undefined) return;
  if (client.status === 'ready') {
    try {
      await client.quit();
      return;
    } catch {
      client.disconnect();
      return;
    }
  }
  client.disconnect();
}

beforeAll(async () => {
  const url = requireRedisUrl(process.env);
  try {
    redis = new Redis(url, {
      keyPrefix: prefix,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
    });
    redis.on('error', () => undefined);
    scanner = redis.duplicate({ keyPrefix: '' });
    scanner.on('error', () => undefined);
    const activeRedis = redis;
    const activeScanner = scanner;
    await Promise.all([
      new Promise<void>((resolve, reject) => {
        activeRedis.once('ready', resolve);
        activeRedis.once('error', reject);
      }),
      new Promise<void>((resolve, reject) => {
        activeScanner.once('ready', resolve);
        activeScanner.once('error', reject);
      }),
    ]);
    cap = createRedisDevicePinCap(activeRedis, { newId: randomUUID });
    setupReady = true;
  } catch (error) {
    await closeClient(scanner);
    await closeClient(redis);
    throw error;
  }
});

beforeEach(clean);

afterAll(async () => {
  try {
    if (setupReady) await clean();
  } finally {
    await closeClient(scanner);
    await closeClient(redis);
  }
});

async function admissions(count: number) {
  const admitted = await Promise.all(Array.from({ length: count }, () => cap.admit(device)));
  return admitted.map((result) => {
    expect(result.kind).toBe('ok');
    return result.kind === 'ok' ? result.admission : '';
  });
}

function admissionAt(values: string[], index: number): string {
  const value = values[index];
  if (value === undefined) throw new Error('missing synthetic admission');
  return value;
}

it('admit, failure, success and release consume exactly their own admission', async () => {
  const admitted = await admissions(3);
  const failed = admissionAt(admitted, 0);
  const succeeded = admissionAt(admitted, 1);
  const released = admissionAt(admitted, 2);
  expect(await cap.failure(device, failed)).toBe('failed');
  expect(await cap.success(device, succeeded)).toBe('ok');
  await cap.release(device, released);
  expect(await cap.failure(device, failed)).toBe('expired');
  expect(await cap.success(device, succeeded)).toBe('expired');
  expect(await cap.failure(device, released)).toBe('expired');
});

it('a success does not clear earlier failures', async () => {
  const admitted = await admissions(2);
  expect(await cap.failure(device, admissionAt(admitted, 0))).toBe('failed');
  expect(await cap.success(device, admissionAt(admitted, 1))).toBe('ok');
  const rest = await admissions(9);
  const results = await Promise.all(rest.map((admission) => cap.failure(device, admission)));
  expect(results).toEqual([
    'failed',
    'failed',
    'failed',
    'failed',
    'failed',
    'failed',
    'failed',
    'failed',
    'lockedNew',
  ]);
  expect((await cap.admit(device)).kind).toBe('locked');
});

it('ten failures lock once and an eleventh admitted failure observes the existing lock', async () => {
  const admitted = await admissions(11);
  const results = await Promise.all(
    admitted.slice(0, 10).map((admission) => cap.failure(device, admission)),
  );
  expect(results.filter((result) => result === 'lockedNew')).toHaveLength(1);
  expect(results.filter((result) => result === 'failed')).toHaveLength(9);
  expect(await cap.failure(device, admissionAt(admitted, 10))).toBe('locked');
  expect((await cap.admit(device)).kind).toBe('locked');
});

it('a new lock leaves one claimable audit marker until confirmed', async () => {
  const admitted = await admissions(10);
  await Promise.all(admitted.map((admission) => cap.failure(device, admission)));
  await expect(cap.claimLockAudit(device)).resolves.toBe(true);
  await expect(cap.claimLockAudit(device)).resolves.toBe(false);
  const claimKey = `pindev:${device.companyId}:${device.deviceId}:lock-audit-claim`;
  if (redis === undefined) throw new Error('redis not initialized');
  await redis.del(claimKey);
  await expect(cap.claimLockAudit(device)).resolves.toBe(true);
  await cap.confirmLockAudit(device);
  await expect(cap.claimLockAudit(device)).resolves.toBe(false);
});

it('a device that never locked has no audit to claim', async () => {
  await expect(cap.claimLockAudit(device)).resolves.toBe(false);
});

it('debate #3 twelve admissions cannot produce a success after ten failures lock the device', async () => {
  const admitted = await admissions(12);
  const failures = await Promise.all(
    admitted.slice(0, 10).map((admission) => cap.failure(device, admission)),
  );
  expect(failures.filter((result) => result === 'lockedNew')).toHaveLength(1);
  const successes = await Promise.all(
    admitted.slice(10).map((admission) => cap.success(device, admission)),
  );
  expect(successes).toEqual(['locked', 'locked']);
  expect(successes).not.toContain('ok');
});

it('debate #3 a success racing the tenth failure still ends locked with at most one lockedNew', async () => {
  const admitted = await admissions(12);
  const earlier = await Promise.all(
    admitted.slice(0, 9).map((admission) => cap.failure(device, admission)),
  );
  expect(earlier).toEqual(Array(9).fill('failed'));
  const [success, tenth, later] = await Promise.all([
    cap.success(device, admissionAt(admitted, 9)),
    cap.failure(device, admissionAt(admitted, 10)),
    cap.failure(device, admissionAt(admitted, 11)),
  ]);
  expect(['ok', 'locked']).toContain(success);
  expect(['locked', 'lockedNew']).toContain(tenth);
  expect(later).toBe('locked');
  expect([...earlier, tenth].filter((result) => result === 'lockedNew')).toHaveLength(1);
  expect((await cap.admit(device)).kind).toBe('locked');
});

it('an admission whose deadline passed returns expired for failure and success', async () => {
  const key = `pindev:${device.companyId}:${device.deviceId}:inflight`;
  if (redis === undefined) throw new Error('redis not initialized');
  await redis.zadd(key, Date.now() - 1000, 'synthetic-expired');
  expect(await cap.failure(device, 'synthetic-expired')).toBe('expired');
  await redis.zadd(key, Date.now() - 1000, 'synthetic-expired');
  expect(await cap.success(device, 'synthetic-expired')).toBe('expired');
});

it('clean removes all prefixed device-pin keys from Redis (#1011)', async () => {
  if (scanner === undefined) throw new Error('redis scanner not initialized');
  const admitted = await admissions(10);
  await Promise.all(admitted.map((admission) => cap.failure(device, admission)));
  expect((await scanner.keys(`${prefix}*`)).length).toBeGreaterThan(0);
  await clean();
  expect(await scanner.keys(`${prefix}*`)).toEqual([]);
  expect((await cap.admit(device)).kind).toBe('ok');
});

it('requireRedisUrl and testRedis fail fast when REDIS_URL is missing, blank, or lacks hostname (#1017)', () => {
  for (const bad of [
    {},
    { REDIS_URL: '   ' },
    { REDIS_URL: 'redis://' },
    { REDIS_URL: 'rediss://' },
    { REDIS_URL: 'http://127.0.0.1:6379' },
  ]) {
    expect(() => requireRedisUrl(bad)).toThrow(/REDIS_URL/);
    expect(() => testRedis(bad)).toThrow(/REDIS_URL/);
  }
});
