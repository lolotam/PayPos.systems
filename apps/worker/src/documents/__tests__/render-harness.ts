import { Writable } from 'node:stream';
import { Queue, QueueEvents, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import {
  DOCUMENTS_RENDER_QUEUE,
  documentRenderJobOptions,
  documentStatusKey,
} from '@pospay/contracts';
import type { DocumentRenderer } from '@pospay/documents';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger, type Logger } from '@pospay/observability';

import { DocumentSourceRegistry } from '../source-registry.ts';
import { startDocumentRendering, type DocumentRendering } from '../start-documents.ts';
import { WORKER_LOG_EVENTS } from '../../shared/log-events.ts';

const ids = systemUuidV7();

export const redisUrl =
  process.env['REDIS_URL'] ||
  `redis://:${process.env['REDIS_PASSWORD'] || 'pospay_dev_redis'}@127.0.0.1:6379`;

export class FakeRenderer implements DocumentRenderer {
  available = true;
  readonly seen: string[] = [];
  failWith: Error | undefined;
  pdf = Uint8Array.from(Buffer.from('%PDF-MARKER'));
  readonly #down: Array<() => void> = [];
  readonly #up: Array<() => void> = [];

  async start(): Promise<void> {
    if (this.available) for (const listener of this.#up) listener();
  }

  async close(): Promise<void> {
    this.available = false;
    for (const listener of this.#down) listener();
  }

  isAvailable(): boolean {
    return this.available;
  }

  onUnavailable(listener: () => void): void {
    this.#down.push(listener);
  }

  onAvailable(listener: () => void): void {
    this.#up.push(listener);
  }

  async render(html: string): Promise<Uint8Array> {
    this.seen.push(html);
    if (this.failWith !== undefined) throw this.failWith;
    return this.pdf;
  }
}

export interface Opened {
  readonly redis: Redis;
  readonly registry: DocumentSourceRegistry;
  readonly handle: DocumentRendering;
  readonly queue: Queue;
  readonly events: QueueEvents;
  readonly lines: string[];
  readonly renderer: DocumentRenderer;
  readonly logger: Logger;
}

function sink(lines: string[]): Writable {
  return new Writable({
    write(chunk, encoding, done) {
      void encoding;
      lines.push(String(chunk));
      done();
    },
  });
}

export async function openRender(options?: {
  readonly renderer?: DocumentRenderer;
  readonly intervalMs?: number;
}): Promise<Opened> {
  const prefix = `documents-test-${ids.newId()}`;
  const lines: string[] = [];
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
  const registry = new DocumentSourceRegistry();
  const renderer = options?.renderer ?? new FakeRenderer();
  const logger = createLogger('info', { events: WORKER_LOG_EVENTS, destination: sink(lines) });
  let tick = 0;
  const handle = await startDocumentRendering({
    redis,
    redisUrl,
    logger,
    registry,
    renderer,
    prefix,
    clock: {
      now: () => {
        tick += 5;
        return tick;
      },
    },
    ...(options?.intervalMs === undefined ? {} : { livenessIntervalMs: options.intervalMs }),
  });
  const queue = new Queue(DOCUMENTS_RENDER_QUEUE, { connection: { url: redisUrl }, prefix });
  const events = new QueueEvents(DOCUMENTS_RENDER_QUEUE, { connection: { url: redisUrl }, prefix });
  await events.waitUntilReady();
  return { redis, registry, handle, queue, events, lines, renderer, logger };
}

export async function closeRender(opened: Opened): Promise<void> {
  await opened.queue.obliterate({ force: true }).catch(() => undefined);
  await opened.handle.close();
  await opened.events.close();
  await opened.queue.close();
  opened.redis.disconnect();
}

export function renderId(): string {
  return ids.newId();
}

export async function finishJob(opened: Opened, data: unknown, id: string): Promise<unknown> {
  const job: Job = await opened.queue.add('render', data, documentRenderJobOptions(id));
  return job.waitUntilFinished(opened.events);
}

export async function statusOf(opened: Opened, companyId: string, id: string): Promise<Record<string, string>> {
  return opened.redis.hgetall(documentStatusKey(companyId, id));
}

/** الحالة اللي الـ API بيكتبها قبل ما الوظيفة تتاخد. من غيرها الانتقال بيتقفل والوظيفة بتتخطى. */
export async function seedQueued(opened: Opened, companyId: string, id: string): Promise<void> {
  await opened.redis.hset(documentStatusKey(companyId, id), {
    state: 'QUEUED',
    requested_by: 'user-1',
    filename: 'a.pdf',
  });
}

export async function useRender(
  run: (opened: Opened) => Promise<void>,
  options?: { readonly renderer?: DocumentRenderer; readonly intervalMs?: number },
): Promise<void> {
  const opened = await openRender(options);
  try {
    await run(opened);
  } finally {
    await closeRender(opened);
  }
}
