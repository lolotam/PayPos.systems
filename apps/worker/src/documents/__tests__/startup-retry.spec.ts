import { Writable } from 'node:stream';
import type { DocumentRenderer } from '@pospay/documents';
import { createLogger } from '@pospay/observability';
import { Redis } from 'ioredis';
import { expect, it } from 'vitest';

import { WORKER_LOG_EVENTS } from '../../shared/log-events.ts';
import { startDocumentRendering } from '../start-documents.ts';
import { FakeRenderer, redisUrl } from './render-harness.ts';

function linesOf(): { lines: string[]; logger: ReturnType<typeof createLogger> } {
  const lines: string[] = [];
  const logger = createLogger('info', {
    events: WORKER_LOG_EVENTS,
    destination: new Writable({
      write(chunk, encoding, done) {
        void encoding;
        lines.push(String(chunk));
        done();
      },
    }),
  });
  return { lines, logger };
}

function brokenStart(message: string): DocumentRenderer {
  const error = new Error(message);
  return {
    start: () => Promise.reject(error),
    close: async () => undefined,
    isAvailable: () => false,
    onUnavailable: () => undefined,
    onAvailable: () => undefined,
    render: async () => new Uint8Array(),
  };
}

it('retries a failed renderer start instead of closing the capability', async () => {
  const { lines, logger } = linesOf();
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
  const ready = new FakeRenderer();
  let calls = 0;
  const handle = await startDocumentRendering({
    redis,
    redisUrl,
    logger,
    clock: { now: () => 1 },
    retryDelaysMs: [0, 0, 0],
    sleep: async () => undefined,
    livenessIntervalMs: 60_000,
    createRenderer: () => {
      calls += 1;
      if (calls < 3) return brokenStart('slow start /var/run/chromium');
      return ready;
    },
  });
  try {
    expect(calls).toBe(3);
    expect(ready.isAvailable()).toBe(true);
    const text = lines.join('\n');
    expect(text).toContain('"error_class":"Error"');
    expect(text).not.toContain('/var/run/chromium');
    expect(text).toContain('document renderer unavailable');
  } finally {
    await handle.close();
    redis.disconnect();
  }
});
