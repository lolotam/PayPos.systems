import { Writable } from 'node:stream';
import type { DocumentRenderer, StartOptions } from '@pospay/documents';
import { createLogger } from '@pospay/observability';
import type { Redis } from 'ioredis';
import { expect, it } from 'vitest';

import { WORKER_LOG_EVENTS } from '../../shared/log-events.ts';
import { startDocumentRendering } from '../start-documents.ts';
import { redisUrl } from './render-harness.ts';

function stubRedis(): Redis {
  return {
    status: 'ready',
    on: () => undefined,
    off: () => undefined,
    set: async () => 'OK',
    del: async () => 1,
  } as unknown as Redis;
}

it('aborts an overdue hanging start and retries to recover', async () => {
  const logger = createLogger('info', {
    events: WORKER_LOG_EVENTS,
    destination: new Writable({
      write(_chunk, _encoding, done) {
        done();
      },
    }),
  });
  const signals: Array<AbortSignal | undefined> = [];
  let available = false;
  let onUp: (() => void) | undefined;
  const renderer: DocumentRenderer = {
    start: async (options?: StartOptions) => {
      signals.push(options?.signal);
      if (signals.length === 1) return new Promise<void>(() => undefined);
      available = true;
      onUp?.();
    },
    close: async () => {
      available = false;
    },
    isAvailable: () => available,
    onUnavailable: () => undefined,
    onAvailable: (listener) => {
      onUp = listener;
    },
    render: async () => new Uint8Array(),
  };
  const handle = await startDocumentRendering({
    redis: stubRedis(),
    redisUrl,
    logger,
    clock: { now: () => 1 },
    startupMs: 20,
    retryDelaysMs: [5],
    sleep: async () => undefined,
    livenessIntervalMs: 60_000,
    renderer,
  });
  try {
    const deadline = Date.now() + 2_000;
    while (!available && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(signals).toHaveLength(2);
    expect(signals[0]?.aborted).toBe(true);
    expect(available).toBe(true);
  } finally {
    await handle.close();
  }
});
