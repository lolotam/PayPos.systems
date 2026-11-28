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

function silentLogger() {
  return createLogger('info', {
    events: WORKER_LOG_EVENTS,
    destination: new Writable({
      write(_chunk, _encoding, done) {
        done();
      },
    }),
  });
}

it('aborts an overdue start and retries only once cancellation settles', async () => {
  const events: string[] = [];
  const signals: Array<AbortSignal | undefined> = [];
  let available = false;
  let onUp: (() => void) | undefined;
  const renderer: DocumentRenderer = {
    start: async (options?: StartOptions) => {
      signals.push(options?.signal);
      if (signals.length === 1) {
        await new Promise<void>((_, reject) => {
          options?.signal?.addEventListener(
            'abort',
            () => {
              events.push('cancelled-1');
              reject(new Error('ABORTED'));
            },
            { once: true },
          );
        });
        return;
      }
      events.push('start-2');
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
    logger: silentLogger(),
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
    expect(events).toEqual(['cancelled-1', 'start-2']);
    expect(available).toBe(true);
  } finally {
    await handle.close();
  }
});

it('does not call start() a second time while a non-cancelling start remains active', async () => {
  const signals: Array<AbortSignal | undefined> = [];
  const renderer: DocumentRenderer = {
    start: (options?: StartOptions) => {
      signals.push(options?.signal);
      return new Promise<void>(() => undefined);
    },
    close: async () => undefined,
    isAvailable: () => false,
    onUnavailable: () => undefined,
    onAvailable: () => undefined,
    render: async () => new Uint8Array(),
  };
  const handle = await startDocumentRendering({
    redis: stubRedis(),
    redisUrl,
    logger: silentLogger(),
    clock: { now: () => 1 },
    startupMs: 15,
    retryDelaysMs: [5],
    sleep: async () => undefined,
    livenessIntervalMs: 60_000,
    renderer,
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 90));
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(true);
  } finally {
    await handle.close();
  }
});
