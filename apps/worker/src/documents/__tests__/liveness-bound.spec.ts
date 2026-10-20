import type { Redis } from 'ioredis';
import { expect, it } from 'vitest';

import { startRendererLiveness } from '../liveness.ts';
import { FakeRenderer } from './render-harness.ts';

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
