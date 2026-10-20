import { Writable } from 'node:stream';
import { Queue } from 'bullmq';
import {
  DOCUMENTS_RENDER_QUEUE,
  documentRenderJobOptions,
  documentStatusKey,
} from '@pospay/contracts';
import { createLogger } from '@pospay/observability';
import { Redis } from 'ioredis';
import { expect, it } from 'vitest';

import { WORKER_LOG_EVENTS } from '../../shared/log-events.ts';
import { startDocumentRendering, type DocumentRendering } from '../start-documents.ts';
import { FakeRenderer, redisUrl, renderId } from './render-harness.ts';

function logger(): ReturnType<typeof createLogger> {
  return createLogger('info', {
    events: WORKER_LOG_EVENTS,
    destination: new Writable({
      write(_chunk, _encoding, done) {
        done();
      },
    }),
  });
}

async function untilState(redis: Redis, companyId: string, id: string, state: string): Promise<void> {
  const key = documentStatusKey(companyId, id);
  const started = Date.now();
  while (Date.now() - started < 8_000) {
    if ((await redis.hget(key, 'state')) === state) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`state stayed ${String(await redis.hget(key, 'state'))}`);
}

it('marks a stalled active job FAILED without a second render', async () => {
  const prefix = `documents-stall-${renderId()}`;
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
  const companyId = renderId();
  const id = renderId();
  const hung = new FakeRenderer();
  const second = new FakeRenderer();
  let renders = 0;
  hung.render = () => {
    renders += 1;
    return new Promise(() => undefined);
  };
  const shared = {
    redis,
    redisUrl,
    logger: logger(),
    clock: { now: () => 1 },
    prefix,
    lockDurationMs: 400,
    stalledIntervalMs: 200,
    maxStalledCount: 0,
    livenessIntervalMs: 60_000,
  };
  let first: DocumentRendering | undefined;
  let next: DocumentRendering | undefined;
  const queue = new Queue(DOCUMENTS_RENDER_QUEUE, { connection: { url: redisUrl }, prefix });
  try {
    first = await startDocumentRendering({ ...shared, renderer: hung });
    first.registry.register('fixture', { load: async () => '<p>x</p>' });
    await redis.hset(documentStatusKey(companyId, id), {
      state: 'QUEUED',
      requested_by: 'user-1',
      filename: 'a.pdf',
    });
    await queue.add('render', { company_id: companyId, render_id: id, kind: 'fixture' }, documentRenderJobOptions(id));
    await untilState(redis, companyId, id, 'RENDERING');
    await first.stop(true);
    next = await startDocumentRendering({ ...shared, renderer: second });
    await untilState(redis, companyId, id, 'FAILED');
    expect((await redis.hget(documentStatusKey(companyId, id), 'error_code'))).toBe('DOCUMENT_RENDER_FAILED');
    expect(renders).toBe(1);
    expect(second.seen).toEqual([]);
  } finally {
    await next?.close();
    await first?.close();
    await queue.obliterate({ force: true }).catch(() => undefined);
    await queue.close();
    redis.disconnect();
  }
}, 15_000);
