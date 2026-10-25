import { Writable } from 'node:stream';
import { DOCUMENT_RENDERER_ALIVE_KEY, DOCUMENT_XLSX_MIME_TYPE } from '@pospay/contracts';
import type { DocumentRenderer } from '@pospay/documents';
import { createLogger } from '@pospay/observability';
import { Redis } from 'ioredis';
import { expect, it } from 'vitest';

import { WORKER_LOG_EVENTS } from '../../shared/log-events.ts';
import { DocumentSourceRegistry } from '../source-registry.ts';
import { beginDocumentRendering, startDocumentRendering } from '../start-documents.ts';
import {
  FakeRenderer,
  finishJob,
  redisUrl,
  renderId,
  seedQueued,
  statusOf,
  useRender,
} from './render-harness.ts';

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

function job(companyId: string, id: string, kind: string) {
  return { company_id: companyId, render_id: id, kind };
}

function setupFailures(lines: string[]): string[] {
  return lines.filter((line) => line.includes('"reason":"SETUP_FAILED"'));
}

it('retries the attempt when the renderer cannot be created', async () => {
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
      if (calls < 3) return Promise.reject(new Error('slow start /var/run/chromium'));
      return ready;
    },
  });
  try {
    expect(calls).toBe(3);
    expect(ready.isAvailable()).toBe(true);
    const text = lines.join('\n');
    expect(text).toContain('"error_class":"OTHER"');
    expect(text).toContain('"reason":"SETUP_FAILED"');
    expect(text).not.toContain('/var/run/chromium');
    expect(text).not.toContain('slow start');
    expect(text).not.toContain('error_message');
    expect(text).toContain('document renderer unavailable');
  } finally {
    await handle.close();
    redis.disconnect();
  }
});

it('keeps the queue live when the renderer start fails', async () => {
  const registry = new DocumentSourceRegistry({
    fixtureXlsx: { mimeType: DOCUMENT_XLSX_MIME_TYPE },
  });
  await useRender(
    async (opened) => {
      const companyId = renderId();
      const id = renderId();
      opened.registry.register('fixtureXlsx', {
        output: 'bytes',
        mimeType: DOCUMENT_XLSX_MIME_TYPE,
        load: async () => Uint8Array.from(Buffer.from('XLSX-AFTER-FAILED-START')),
      });
      await seedQueued(opened, companyId, id);
      await finishJob(opened, job(companyId, id, 'fixtureXlsx'), id);
      expect((await statusOf(opened, companyId, id))['state']).toBe('READY');
      const text = opened.lines.join('\n');
      expect(text).toContain('"error_class":"OTHER"');
      expect(text).toContain('"reason":"SETUP_FAILED"');
      expect(text).not.toContain('/var/run/chromium');
      expect(text).not.toContain('slow start');
      expect(text).not.toContain('error_message');
      expect(text).toContain('document renderer unavailable');
    },
    { renderer: brokenStart('slow start /var/run/chromium'), registry },
  );
});

it('retries the liveness publisher after a Redis that is not ready', async () => {
  const { lines, logger } = linesOf();
  let sleeps = 0;
  const sets: string[] = [];
  const redis = {
    get status(): string {
      return sleeps < 2 ? 'end' : 'ready';
    },
    on: () => undefined,
    off: () => undefined,
    set: async (key: string) => {
      sets.push(key);
      return 'OK';
    },
    del: async () => 1,
  } as unknown as Redis;
  const handle = beginDocumentRendering({
    redis,
    redisUrl,
    logger,
    clock: { now: () => 1 },
    retryDelaysMs: [0],
    sleep: async () => {
      sleeps += 1;
    },
    livenessIntervalMs: 60_000,
    renderer: new FakeRenderer(),
  });
  try {
    await handle.started;
    expect(sets).toContain(DOCUMENT_RENDERER_ALIVE_KEY);
    expect(setupFailures(lines).length).toBeGreaterThanOrEqual(2);
    expect(
      lines.filter((line) => line.includes('document renderer unavailable')).length,
    ).toBeGreaterThanOrEqual(2);
  } finally {
    await handle.close();
  }
});

it('stops retrying the liveness publisher when the capability is closed', async () => {
  const { lines, logger } = linesOf();
  const redis = {
    status: 'end',
    on: () => undefined,
    off: () => undefined,
    set: async () => 'OK',
    del: async () => 1,
  } as unknown as Redis;
  const handle = beginDocumentRendering({
    redis,
    redisUrl,
    logger,
    clock: { now: () => 1 },
    retryDelaysMs: [0],
    sleep: () => new Promise<void>((resolve) => setTimeout(resolve, 5)),
    livenessIntervalMs: 60_000,
    renderer: new FakeRenderer(),
  });
  try {
    const deadline = Date.now() + 2_000;
    while (setupFailures(lines).length < 2 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(setupFailures(lines).length).toBeGreaterThanOrEqual(2);
    await handle.close();
    const before = lines.length;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(lines.length).toBe(before);
    await handle.started;
  } finally {
    await handle.close();
  }
});
