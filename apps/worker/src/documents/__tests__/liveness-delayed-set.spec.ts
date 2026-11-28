import type { Redis } from 'ioredis';
import { expect, it } from 'vitest';

import { startRendererLiveness } from '../liveness.ts';
import { FakeRenderer } from './render-harness.ts';

function yieldNow(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function delayedSetRedisStub(): {
  redis: Redis;
  ops: string[];
  getStored: () => string | null;
  getSets: () => number;
  releaseFirst: () => void;
} {
  let stored: string | null = null;
  let releaseFirstFn: (() => void) | undefined;
  let sets = 0;
  const ops: string[] = [];
  const redis = {
    status: 'ready',
    on() {
      return this;
    },
    off() {
      return this;
    },
    set(_key: string, value: string) {
      sets += 1;
      ops.push(`set-${sets}`);
      if (sets === 1) {
        return new Promise((resolve) => {
          releaseFirstFn = () => {
            stored = value;
            resolve('OK');
          };
        });
      }
      stored = value;
      return Promise.resolve('OK');
    },
    async del() {
      ops.push('del');
      stored = null;
      return 1;
    },
    connect() {
      return Promise.resolve();
    },
  } as unknown as Redis;
  return {
    redis,
    ops,
    getStored: () => stored,
    getSets: () => sets,
    releaseFirst: () => releaseFirstFn?.(),
  };
}

it('keeps the alive key intact and refreshes it when a delayed SET settles after recovery', async () => {
  const { redis, ops, getStored, getSets, releaseFirst } = delayedSetRedisStub();
  const renderer = new FakeRenderer();
  const liveness = await startRendererLiveness({
    redis,
    renderer,
    intervalMs: 60_000,
    readyTimeoutMs: 1_000,
    commandTimeoutMs: 5,
  });
  await new Promise((resolve) => setTimeout(resolve, 15));
  await renderer.close();
  await yieldNow();
  expect(getStored()).toBeNull();
  ops.length = 0;
  renderer.available = true;
  await renderer.start();
  expect(getSets()).toBe(1);
  releaseFirst();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(ops).not.toContain('del');
  expect(getSets()).toBe(2);
  expect(getStored()).toBe('1');
  await liveness.stop();
});
