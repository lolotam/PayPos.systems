import type { Redis } from 'ioredis';
import { expect, it } from 'vitest';

import { startRendererLiveness } from '../liveness.ts';
import { FakeRenderer } from './render-harness.ts';

function yieldNow(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function redisStub(status: string | undefined): Redis {
  return {
    status,
    on() {
      return this;
    },
    off() {
      return this;
    },
    async set() {
      return 'OK';
    },
    async del() {
      return 1;
    },
    connect() {
      return Promise.resolve();
    },
  } as unknown as Redis;
}

function recordingRedisStub(status: string): { redis: Redis; sets: string[] } {
  const sets: string[] = [];
  const redis = {
    status,
    on() {
      return this;
    },
    off() {
      return this;
    },
    async set(key: string) {
      sets.push(key);
      return 'OK';
    },
    async del() {
      return 1;
    },
    connect() {
      return Promise.resolve();
    },
  } as unknown as Redis;
  return { redis, sets };
}

it('bounds a Redis client that never becomes ready', async () => {
  const started = Date.now();
  await expect(
    startRendererLiveness({
      redis: redisStub('connecting'),
      renderer: new FakeRenderer(),
      readyTimeoutMs: 25,
    }),
  ).rejects.toThrow('redis ready timed out');
  expect(Date.now() - started).toBeLessThan(1_000);
});

it('publishes immediately when redis is already ready', async () => {
  let sets = 0;
  const redis = redisStub('ready');
  redis.set = async () => {
    sets += 1;
    return 'OK';
  };
  const started = Date.now();
  const live = await startRendererLiveness({
    redis,
    renderer: new FakeRenderer(),
    readyTimeoutMs: 30_000,
    intervalMs: 60_000,
  });
  expect(sets).toBeGreaterThan(0);
  expect(Date.now() - started).toBeLessThan(500);
  await live.stop();
});

it('drops a liveness key published by a SET that settles after disconnect', async () => {
  let stored: string | null = null;
  const pending: Array<() => void> = [];
  const redis = redisStub('ready');
  redis.set = () =>
    new Promise((resolve) => {
      pending.push(() => {
        stored = '1';
        resolve('OK');
      });
    });
  redis.del = async () => {
    stored = null;
    return 1;
  };
  const renderer = new FakeRenderer();
  const starting = startRendererLiveness({
    redis,
    renderer,
    intervalMs: 20,
    readyTimeoutMs: 1_000,
  });
  await yieldNow();
  expect(pending).toHaveLength(1);
  renderer.available = false;
  await renderer.close();
  const release = pending[0];
  if (release === undefined) throw new Error('missing pending set');
  release();
  const live = await starting;
  await yieldNow();
  expect(stored).toBeNull();
  await new Promise((resolve) => setTimeout(resolve, 60));
  expect(stored).toBeNull();
  expect(pending).toHaveLength(1);
  await live.stop();
});

it('keeps a single SET pending when redis never answers', async () => {
  const commandMs = 100;
  let sets = 0;
  let dels = 0;
  const redis = redisStub('ready');
  redis.set = () => {
    sets += 1;
    return new Promise(() => undefined);
  };
  redis.del = () => {
    dels += 1;
    return new Promise(() => undefined);
  };
  const live = await startRendererLiveness({
    redis,
    renderer: new FakeRenderer(),
    intervalMs: 10,
    commandTimeoutMs: commandMs,
    readyTimeoutMs: 1_000,
  });
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(sets).toBe(1);
  expect(dels).toBe(0);
  const started = Date.now();
  await live.stop();
  expect(Date.now() - started).toBeLessThan(commandMs + 80);
  expect(sets).toBe(1);
  expect(dels).toBe(1);
});

it('leaves nothing armed when the liveness start fails', async () => {
  const { redis, sets } = recordingRedisStub('end');
  const renderer = new FakeRenderer();
  renderer.available = false;
  await expect(startRendererLiveness({ redis, renderer, intervalMs: 5 })).rejects.toThrow(
    'redis ended',
  );
  renderer.available = true;
  await renderer.start();
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(sets).toEqual([]);
});
