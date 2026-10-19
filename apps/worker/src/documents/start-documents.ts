import { DOCUMENTS_RENDER_QUEUE } from '@pospay/contracts';
import { PlaywrightDocumentRenderer, type DocumentRenderer } from '@pospay/documents';
import type { Logger } from '@pospay/observability';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';

import { startRendererLiveness, type RendererLiveness } from './liveness.ts';
import { processDocumentJob, type EpochClock } from './process-job.ts';
import { DocumentSourceRegistry } from './source-registry.ts';

const LOCK_MS = 45_000;

export interface DocumentRendering {
  stop(): Promise<void>;
  close(): Promise<void>;
  readonly registry: DocumentSourceRegistry;
}

export interface StartDocumentsInput {
  readonly redis: Redis;
  readonly redisUrl: string;
  readonly logger: Logger;
  readonly clock: EpochClock;
  readonly renderer?: DocumentRenderer;
  readonly registry?: DocumentSourceRegistry;
  readonly prefix?: string;
  readonly livenessIntervalMs?: number;
}

function openRenderer(logger: Logger, injected: DocumentRenderer | undefined): DocumentRenderer {
  if (injected !== undefined) return injected;
  return new PlaywrightDocumentRenderer({
    onLaunchError: () => {
      logger.warn(
        { capability: { name: 'DOCUMENTS', state: 'UNAVAILABLE', reason: 'LAUNCH_FAILED' } },
        'document renderer unavailable',
      );
    },
  });
}

async function openWorker(
  input: StartDocumentsInput,
  registry: DocumentSourceRegistry,
  renderer: DocumentRenderer,
): Promise<{ worker: Worker; connection: Redis }> {
  const connection = new Redis(input.redisUrl, {
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
  });
  connection.on('error', () => undefined);
  // عميل من غير حالة مش هيبعت ready، وwaitUntilReady كان هيعلّق إقلاع الوركر كله.
  if (typeof connection.once !== 'function' || typeof connection.status !== 'string') {
    connection.disconnect();
    throw new Error('DOCUMENT_REDIS_UNUSABLE');
  }
  let worker: Worker | undefined;
  try {
    worker = new Worker(
      DOCUMENTS_RENDER_QUEUE,
      (job) =>
        processDocumentJob(job, {
          redis: input.redis,
          registry,
          renderer,
          clock: input.clock,
          logger: input.logger,
        }),
      {
        connection,
        concurrency: 2,
        lockDuration: LOCK_MS,
        ...(input.prefix === undefined ? {} : { prefix: input.prefix }),
      },
    );
    worker.on('error', () => undefined);
    await worker.waitUntilReady();
    return { worker, connection };
  } catch (error) {
    await worker?.close().catch(() => undefined);
    connection.disconnect();
    throw error;
  }
}

function bindLifecycle(
  opened: { worker: Worker; connection: Redis },
  liveness: RendererLiveness,
  renderer: DocumentRenderer,
  registry: DocumentSourceRegistry,
): DocumentRendering {
  let stopped = false;
  let closed = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    await opened.worker.close();
  };
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await stop();
    await liveness.stop();
    await renderer.close();
    opened.connection.disconnect();
  };
  return { stop, close, registry };
}

async function openQueue(
  input: StartDocumentsInput,
  registry: DocumentSourceRegistry,
  renderer: DocumentRenderer,
): Promise<DocumentRendering> {
  let liveness: RendererLiveness | undefined;
  try {
    liveness = await startRendererLiveness({
      redis: input.redis,
      renderer,
      ...(input.livenessIntervalMs === undefined ? {} : { intervalMs: input.livenessIntervalMs }),
    });
    const opened = await openWorker(input, registry, renderer);
    return bindLifecycle(opened, liveness, renderer, registry);
  } catch (error) {
    await liveness?.stop().catch(() => undefined);
    await renderer.close().catch(() => undefined);
    throw error;
  }
}

/**
 * قدرة اختيارية: فشل Chromium بيسجّل تحذير والوركر يكمل.
 * الإيقاف بيقفل طابور BullMQ الأول، وبعدين المتصفح.
 */
export async function startDocumentRendering(input: StartDocumentsInput): Promise<DocumentRendering> {
  const registry = input.registry ?? new DocumentSourceRegistry();
  const renderer = openRenderer(input.logger, input.renderer);
  renderer.onAvailable(() => {
    input.logger.info(
      { capability: { name: 'DOCUMENTS', state: 'AVAILABLE' } },
      'document renderer available',
    );
  });
  await renderer.start();
  return openQueue(input, registry, renderer);
}
