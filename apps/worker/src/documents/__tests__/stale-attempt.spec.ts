import { Writable } from 'node:stream';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import {
  DOCUMENTS_RENDER_QUEUE,
  documentRenderJobOptions,
  documentStatusKey,
} from '@pospay/contracts';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import { expect, it } from 'vitest';

import { DocumentSourceRegistry } from '../source-registry.ts';
import { beginDocumentRendering } from '../start-documents.ts';
import { WORKER_LOG_EVENTS } from '../../shared/log-events.ts';
import { FakeRenderer, redisUrl, renderId } from './render-harness.ts';

const ids = systemUuidV7();

function quietLogger(): ReturnType<typeof createLogger> {
  return createLogger('info', {
    events: WORKER_LOG_EVENTS,
    destination: new Writable({
      write(_chunk, _encoding, done) {
        done();
      },
    }),
  });
}

async function until(check: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

it('keeps the PDF deferral when a stale attempt resolves late', async () => {
  const prefix = `documents-stale-${ids.newId()}`;
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
  const queue = new Queue(DOCUMENTS_RENDER_QUEUE, { connection: { url: redisUrl }, prefix });
  const registry = new DocumentSourceRegistry();
  registry.register('fixture', { load: async () => '<p>ok</p>' });
  const stale = new FakeRenderer();
  const current = new FakeRenderer();
  current.available = false;
  let calls = 0;
  let release: (renderer: FakeRenderer) => void = () => undefined;
  const late = new Promise<FakeRenderer>((resolve) => {
    release = resolve;
  });
  const handle = beginDocumentRendering({
    redis,
    redisUrl,
    logger: quietLogger(),
    registry,
    prefix,
    clock: { now: () => 1 },
    startupMs: 50,
    retryDelaysMs: [0],
    sleep: async () => undefined,
    createRenderer: () => {
      calls += 1;
      if (calls === 1) return late;
      return current;
    },
  });
  try {
    // المحاولة الجاية فتحت الطابور؛ الأولى لسه معلّقة في openRenderer.
    await handle.started;
    await until(() => calls >= 2, 2_000);
    const companyId = renderId();
    const id = renderId();
    await redis.hset(documentStatusKey(companyId, id), {
      state: 'QUEUED',
      requested_by: 'user-1',
      filename: 'a.pdf',
    });
    await queue.add(
      'render',
      { company_id: companyId, render_id: id, kind: 'fixture' },
      documentRenderJobOptions(id),
    );
    release(stale);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(await redis.hget(documentStatusKey(companyId, id), 'state')).toBe('QUEUED');
    expect(current.seen).toEqual([]);
  } finally {
    await handle.close();
    await queue.obliterate({ force: true }).catch(() => undefined);
    await queue.close();
    redis.disconnect();
  }
}, 20_000);
