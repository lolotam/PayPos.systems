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

async function waitUntil(ready: () => boolean, timeoutMs: number, message: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!ready()) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
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

function awaitQueueEvent(
  events: QueueEvents,
  id: string,
  expected: 'completed' | 'failed',
  timeoutMs = 5_000,
): Promise<void> {
  const promise = new Promise<void>((resolve, reject) => {
    const finish = (cb: () => void): void => {
      clearTimeout(timer);
      events.off('completed', onCompleted);
      events.off('failed', onFailed);
      cb();
    };
    const onCompleted = ({ jobId }: { jobId: string }): void => {
      if (jobId !== id) return;
      finish(() =>
        expected === 'completed' ? resolve() : reject(new Error('unexpected completed event')),
      );
    };
    const onFailed = ({ jobId, failedReason }: { jobId: string; failedReason: string }): void => {
      if (jobId !== id) return;
      finish(() =>
        expected === 'failed'
          ? resolve()
          : reject(new Error(`unexpected failed event: ${failedReason}`)),
      );
    };
    const timer = setTimeout(() => {
      finish(() => reject(new Error(`timed out waiting for queue ${expected} event`)));
    }, timeoutMs);
    events.on('completed', onCompleted);
    events.on('failed', onFailed);
  });
  promise.catch(() => undefined);
  return promise;
}

async function withQueueEnv(
  run: (ctx: { redis: Redis; prefix: string; queue: Queue; events: QueueEvents; renderer: FakeRenderer }) => Promise<void>,
): Promise<void> {
  const prefix = `documents-defer-edge-${renderId()}`;
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
  await whenRedisReady(redis);
  const registry = new DocumentSourceRegistry();
  registry.register('fixture', { load: async () => '<p>delayed-ok</p>' });
  const renderer = new FakeRenderer();
  renderer.available = false;
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
    await run({ redis, prefix, queue, events, renderer });
  } finally {
    await queue.obliterate({ force: true }).catch(() => undefined);
    await handle.close();
    await events.close();
    await queue.close();
    redis.disconnect();
  }
}

it('keeps a delayed job QUEUED and renders to READY when moveToDelayed succeeds in Redis after opTimeoutMs', async () => {
  let delayed = false;
  const spy = spyFirstDelayedReply(() => {
    delayed = true;
  });
  try {
    await withQueueEnv(async ({ redis, queue, events, renderer }) => {
      const companyId = renderId();
      const id = renderId();
      await redis.hset(documentStatusKey(companyId, id), { state: 'QUEUED', requested_by: 'u1', filename: 'a.pdf' });
      const completed = awaitQueueEvent(events, id, 'completed');
      await queue.add('render', { company_id: companyId, render_id: id, kind: 'fixture' }, { ...documentRenderJobOptions(id), attempts: 1 });
      await waitUntil(() => delayed, 3_000, 'moveToDelayed was not called');
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(await redis.hget(documentStatusKey(companyId, id), 'state')).toBe('QUEUED');
      renderer.available = true;
      await renderer.start();
      await completed;
      expect(await redis.hget(documentStatusKey(companyId, id), 'state')).toBe('READY');
      expect(renderer.seen).toEqual(['<p>delayed-ok</p>']);
    });
  } finally {
    spy.mockRestore();
  }
}, 15_000);

it('maps terminal updateProgress deferral timeout to DOCUMENT_RENDER_TIMEOUT', async () => {
  const spy = vi.spyOn(Job.prototype, 'updateProgress').mockImplementation(() => new Promise<void>(() => undefined));
  try {
    await withQueueEnv(async ({ redis, queue, events }) => {
      const companyId = renderId();
      const id = renderId();
      const key = documentStatusKey(companyId, id);
      await redis.hset(key, { state: 'QUEUED', requested_by: 'u1', filename: 'a.pdf' });
      const failed = awaitQueueEvent(events, id, 'failed');
      await queue.add('render', { company_id: companyId, render_id: id, kind: 'fixture' }, { ...documentRenderJobOptions(id), attempts: 1 });
      await failed;
      const deadline = Date.now() + 2_000;
      while ((await redis.hget(key, 'state')) !== 'FAILED' && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(await redis.hget(key, 'state')).toBe('FAILED');
      expect(await redis.hget(key, 'error_code')).toBe('DOCUMENT_RENDER_TIMEOUT');
    });
  } finally {
    spy.mockRestore();
  }
}, 15_000);

it('retries transient markFailed Redis errors in recordExternalJobFailure and succeeds', async () => {
  const { DocumentRenderTimeoutError } = await import('@pospay/documents');
  const { recordExternalJobFailure } = await import('../process-job.ts');
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
  await whenRedisReady(redis);
  const companyId = renderId();
  const id = renderId();
  const key = documentStatusKey(companyId, id);
  const originalEval = redis.eval.bind(redis);
  let evalCalls = 0;
  const evalSpy = vi.spyOn(redis, 'eval').mockImplementation((...args: Parameters<Redis['eval']>) => {
    evalCalls += 1;
    if (evalCalls === 1) return Promise.reject(new Error('ECONNRESET'));
    return originalEval(...args);
  });
  try {
    await redis.hset(key, { state: 'QUEUED', requested_by: 'u1', filename: 'a.pdf' });
    await recordExternalJobFailure(
      {
        finishedOn: Date.now(),
        processedOn: Date.now() - 20,
        data: { company_id: companyId, render_id: id, kind: 'fixture' },
      } as unknown as Job,
      { redis, logger: silentLogger(), clock: { now: () => Date.now() } },
      new DocumentRenderTimeoutError(),
    );
    expect(evalCalls).toBe(2);
    expect(await redis.hget(key, 'state')).toBe('FAILED');
    expect(await redis.hget(key, 'error_code')).toBe('DOCUMENT_RENDER_TIMEOUT');
  } finally {
    evalSpy.mockRestore();
    await redis.del(key).catch(() => undefined);
    redis.disconnect();
  }
});

it('logs a warning instead of state FAILED when all markFailed retries fail in recordExternalJobFailure', async () => {
  const { recordExternalJobFailure } = await import('../process-job.ts');
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
  await whenRedisReady(redis);
  const lines: string[] = [];
  const logger = createLogger('info', {
    events: WORKER_LOG_EVENTS,
    destination: new Writable({
      write(chunk, _encoding, done) {
        lines.push(String(chunk));
        done();
      },
    }),
  });
  const companyId = renderId();
  const id = renderId();
  const evalSpy = vi.spyOn(redis, 'eval').mockRejectedValue(new Error('ECONNRESET'));
  try {
    await recordExternalJobFailure(
      {
        finishedOn: Date.now(),
        processedOn: Date.now() - 20,
        data: { company_id: companyId, render_id: id, kind: 'fixture' },
      } as unknown as Job,
      { redis, logger, clock: { now: () => Date.now() } },
    );
    expect(evalSpy).toHaveBeenCalledTimes(3);
    const parsed = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(parsed.some((entry) => entry['state'] === 'FAILED')).toBe(false);
    expect(parsed).toContainEqual(
      expect.objectContaining({
        msg: 'document renderer unavailable',
        company_id: companyId,
        render_id: id,
        error_code: 'DOCUMENT_RENDER_FAILED',
        capability: { name: 'DOCUMENTS', state: 'UNAVAILABLE', reason: 'STATUS_WRITE_FAILED' },
      }),
    );
  } finally {
    evalSpy.mockRestore();
    redis.disconnect();
  }
});
