import { DOCUMENT_RENDERER_ALIVE_KEY } from '@pospay/contracts';
import type { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { expect, it } from 'vitest';

import { startRendererLiveness } from '../liveness.ts';
import { trackDocumentStartup } from '../startup-session.ts';
import { FakeRenderer, redisUrl } from './render-harness.ts';

function whenReady(redis: Redis): Promise<void> {
  if (redis.status === 'ready') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onReady = (): void => {
      redis.off('error', onError);
      resolve();
    };
    const onError = (error: Error): void => {
      redis.off('ready', onReady);
      reject(error);
    };
    redis.once('ready', onReady);
    redis.once('error', onError);
  });
}

it('drops the alive key on stop while an in-flight render can finish', async () => {
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
  const renderer = new FakeRenderer();
  let releaseRender = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    releaseRender = resolve;
  });
  const originalRender = renderer.render.bind(renderer);
  renderer.render = (html) => gate.then(() => originalRender(html));
  let workerClosed = false;
  const worker = {
    close: async () => {
      workerClosed = true;
    },
  } as unknown as Worker;
  let session: ReturnType<typeof trackDocumentStartup> | undefined;
  try {
    await whenReady(redis);
    session = trackDocumentStartup({
      startupMs: 5_000,
      retryDelaysMs: [60_000],
      sleep: () => new Promise(() => undefined),
      stopped: () => false,
      onFailed: () => undefined,
      run: async (attempt) => {
        attempt.setRenderer(renderer);
        const liveness = await startRendererLiveness({
          redis,
          renderer,
          intervalMs: 60_000,
          readyTimeoutMs: 2_000,
        });
        attempt.setLive({ worker, connection: redis, liveness });
        return true;
      },
    });
    await session.started;
    expect(await redis.get(DOCUMENT_RENDERER_ALIVE_KEY)).toBe('1');
    let finished = false;
    const rendering = renderer.render('<p>held</p>').then((bytes) => {
      finished = true;
      return bytes;
    });
    await session.stop();
    expect(await redis.get(DOCUMENT_RENDERER_ALIVE_KEY)).toBeNull();
    expect(workerClosed).toBe(true);
    expect(renderer.isAvailable()).toBe(true);
    expect(finished).toBe(false);
    releaseRender();
    await expect(rendering).resolves.toEqual(renderer.pdf);
    expect(renderer.isAvailable()).toBe(true);
  } finally {
    releaseRender();
    await session?.close();
    redis.disconnect();
  }
});
