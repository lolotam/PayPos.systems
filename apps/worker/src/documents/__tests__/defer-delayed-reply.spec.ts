import { Writable } from 'node:stream';
import {
  DOCUMENTS_RENDER_QUEUE,
  documentRenderJobOptions,
  documentStatusKey,
} from '@pospay/contracts';
import { createLogger } from '@pospay/observability';
import { Job, Queue, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import { expect, it, vi } from 'vitest';

import { WORKER_LOG_EVENTS } from '../../shared/log-events.ts';
import { DocumentSourceRegistry } from '../source-registry.ts';
import { beginDocumentRendering } from '../start-documents.ts';
import { FakeRenderer, redisUrl, renderId, whenRedisReady } from './render-harness.ts';

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

function spyFirstDelayedReply(onCall: () => void) {
  let calls = 0;
  const original = Job.prototype.moveToDelayed;
  return vi.spyOn(Job.prototype, 'moveToDelayed').mockImplementation(async function (
    this: Job,
    timestamp: number,
    token?: string,
  ) {
    calls += 1;
    await original.call(this, timestamp, token);
    if (calls === 1) {
      onCall();
      await new Promise((resolve) => setTimeout(resolve, 180));
    }
  });
}

function awaitCompletion(events: QueueEvents, id: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    events.on('completed', ({ jobId }) => {
      if (jobId === id) resolve();
    });
    events.on('failed', ({ jobId, failedReason }) => {
      if (jobId === id) reject(new Error(`unexpected failed event: ${failedReason}`));
    });
  });
}

it('keeps a delayed job QUEUED and renders to READY when moveToDelayed succeeds in Redis after opTimeoutMs', async () => {
  const prefix = `documents-delayed-reply-${renderId()}`;
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
  await whenRedisReady(redis);
  const registry = new DocumentSourceRegistry();
  registry.register('fixture', { load: async () => '<p>delayed-ok</p>' });
  const renderer = new FakeRenderer();
  renderer.available = false;
  const companyId = renderId();
  const id = renderId();
  let delayed = false;
  const spy = spyFirstDelayedReply(() => {
    delayed = true;
  });
  const handle = beginDocumentRendering({
    redis,
    redisUrl,
    logger: silentLogger(),
    clock: { now: () => Date.now() },
    registry,
    renderer,
    prefix,
    deferOpTimeoutMs: 40,
  });
  const queue = new Queue(DOCUMENTS_RENDER_QUEUE, { connection: { url: redisUrl }, prefix });
  const events = new QueueEvents(DOCUMENTS_RENDER_QUEUE, {
    connection: { url: redisUrl },
    prefix,
    lastEventId: '0-0',
  });
  try {
    await events.waitUntilReady();
    await redis.hset(documentStatusKey(companyId, id), {
      state: 'QUEUED',
      requested_by: 'user-1',
      filename: 'a.pdf',
    });
    const completed = awaitCompletion(events, id);
    await queue.add(
      'render',
      { company_id: companyId, render_id: id, kind: 'fixture' },
      { ...documentRenderJobOptions(id), attempts: 1 },
    );
    while (!delayed) await new Promise((resolve) => setTimeout(resolve, 10));
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(await redis.hget(documentStatusKey(companyId, id), 'state')).toBe('QUEUED');
    renderer.available = true;
    await renderer.start();
    await completed;
    expect(await redis.hget(documentStatusKey(companyId, id), 'state')).toBe('READY');
    expect(renderer.seen).toEqual(['<p>delayed-ok</p>']);
  } finally {
    spy.mockRestore();
    await queue.obliterate({ force: true }).catch(() => undefined);
    await handle.close();
    await events.close();
    await queue.close();
    redis.disconnect();
  }
}, 15_000);
