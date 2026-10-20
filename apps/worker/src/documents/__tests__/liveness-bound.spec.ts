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
