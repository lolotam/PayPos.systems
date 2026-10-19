import { DOCUMENTS_RENDER_QUEUE } from '@pospay/contracts';
import type { DocumentRenderer } from '@pospay/documents';
import type { Logger } from '@pospay/observability';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';

import { startRendererLiveness, type RendererLiveness } from './liveness.ts';
import type { EpochClock } from './process-job.ts';
import { DocumentSourceRegistry } from './source-registry.ts';

const LOCK_MS = 45_000;
const STARTUP_MS = 30_000;

export interface DocumentRendering {
  stop(): Promise<void>;
  close(): Promise<void>;
  readonly registry: DocumentSourceRegistry;
  /** بيتكمّل لما الطابور يبقى جاهز، أو لما الإقلاع يتقفل أو يتخطى السقف. */
  readonly started: Promise<void>;
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
  readonly startupMs?: number;
  readonly isStopping?: () => boolean;
}

export interface CoreBeforeDocumentsInput {
  startCore(): Promise<void>;
  beginDocuments(): DocumentRendering;
  isStopping(): boolean;
}

interface LiveQueue {
  worker: Worker;
  connection: Redis;
  liveness: RendererLiveness;
}

async function openRenderer(input: StartDocumentsInput): Promise<DocumentRenderer> {
  if (input.renderer !== undefined) {
    bindAvailableLog(input.logger, input.renderer);
    return input.renderer;
  }
  // الاستيراد بيتأجل لبعد فحص Redis، عشان اختبار الإقلاع ما يحمّلش Chromium.
  const { PlaywrightDocumentRenderer } = await import('@pospay/documents');
  const renderer = new PlaywrightDocumentRenderer({
    onLaunchError: () => {
      input.logger.warn(
        { capability: { name: 'DOCUMENTS', state: 'UNAVAILABLE', reason: 'LAUNCH_FAILED' } },
        'document renderer unavailable',
      );
    },
  });
  bindAvailableLog(input.logger, renderer);
  return renderer;
}

function bindAvailableLog(logger: Logger, renderer: DocumentRenderer): void {
  renderer.onAvailable(() => {
    logger.info(
      { capability: { name: 'DOCUMENTS', state: 'AVAILABLE' } },
      'document renderer available',
    );
  });
}

function openQueueConnection(redisUrl: string): Redis {
  const connection = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
  });
  connection.on('error', () => undefined);
  // عميل من غير حالة مش هيبعت ready، وwaitUntilReady كان هيعلّق إقلاع الوركر كله.
  if (typeof connection.once !== 'function' || typeof connection.status !== 'string') {
    connection.disconnect();
    throw new Error('DOCUMENT_REDIS_UNUSABLE');
  }
  return connection;
}

/** فشل العميل يتكشف قبل Chromium. الإطلاق المعلّق ما يبقاش ثمن اتصال ميت. */
function assertQueueRedisUsable(redisUrl: string): void {
  const connection = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
    lazyConnect: true,
  });
  connection.on('error', () => undefined);
  const usable = typeof connection.once === 'function' && typeof connection.status === 'string';
  connection.disconnect();
  if (!usable) throw new Error('DOCUMENT_REDIS_UNUSABLE');
}

async function openWorker(
  input: StartDocumentsInput,
  registry: DocumentSourceRegistry,
  renderer: DocumentRenderer,
): Promise<{ worker: Worker; connection: Redis }> {
  const { processDocumentJob, recordExternalJobFailure } = await import('./process-job.ts');
  const connection = openQueueConnection(input.redisUrl);
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
    worker.on('failed', (job) => {
      if (job == null) return;
      void recordExternalJobFailure(job, {
        redis: input.redis,
        logger: input.logger,
        clock: input.clock,
      }).catch(() => undefined);
    });
    await worker.waitUntilReady();
    return { worker, connection };
  } catch (error) {
    await worker?.close().catch(() => undefined);
    connection.disconnect();
    throw error;
  }
}

function stopping(input: StartDocumentsInput, closed: () => boolean): boolean {
  return closed() || input.isStopping?.() === true;
}

async function bringUp(
  input: StartDocumentsInput,
  registry: DocumentSourceRegistry,
  closed: () => boolean,
  assign: (live: LiveQueue) => void,
  setRenderer: (renderer: DocumentRenderer) => void,
): Promise<void> {
  let liveness: RendererLiveness | undefined;
  try {
    assertQueueRedisUsable(input.redisUrl);
    if (stopping(input, closed)) return;
    const renderer = await openRenderer(input);
    setRenderer(renderer);
    if (stopping(input, closed)) return;
    await renderer.start();
    if (stopping(input, closed)) return;
    liveness = await startRendererLiveness({
      redis: input.redis,
      renderer,
      ...(input.livenessIntervalMs === undefined ? {} : { intervalMs: input.livenessIntervalMs }),
    });
    if (stopping(input, closed)) return;
    const opened = await openWorker(input, registry, renderer);
    if (stopping(input, closed)) {
      await opened.worker.close().catch(() => undefined);
      opened.connection.disconnect();
      return;
    }
    assign({ ...opened, liveness });
    liveness = undefined;
  } finally {
    await liveness?.stop().catch(() => undefined);
  }
}

function warnSetupFailed(logger: Logger): void {
  logger.warn(
    { capability: { name: 'DOCUMENTS', state: 'UNAVAILABLE', reason: 'SETUP_FAILED' } },
    'document renderer unavailable',
  );
}

/**
 * القدرة بتترجع فورًا. إقلاع Chromium وRedis متسقوف، والإغلاق أثناء التعليق
 * بيقفل المحوّل حتى لو الإطلاق لسه ما خلّصش.
 */
export function beginDocumentRendering(input: StartDocumentsInput): DocumentRendering {
  const registry = input.registry ?? new DocumentSourceRegistry();
  const runtime = trackStartup(input, registry);
  return { stop: () => runtime.stop(), close: () => runtime.close(), registry, started: runtime.started };
}

function trackStartup(
  input: StartDocumentsInput,
  registry: DocumentSourceRegistry,
): { started: Promise<void>; stop: () => Promise<void>; close: () => Promise<void> } {
  let opened: LiveQueue | undefined;
  let renderer: DocumentRenderer | undefined;
  let closed = false;
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolveStart: () => void = () => undefined;
  let rejectStart: (error: Error) => void = () => undefined;
  const started = new Promise<void>((resolve, reject) => {
    resolveStart = resolve;
    rejectStart = reject;
  });
  const finish = (error?: Error): void => {
    if (settled) return;
    settled = true;
    if (timer !== undefined) clearTimeout(timer);
    if (error === undefined || closed) resolveStart();
    else {
      warnSetupFailed(input.logger);
      rejectStart(error);
    }
  };
  const stop = async (): Promise<void> => {
    await opened?.worker.close().catch(() => undefined);
  };
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    finish();
    await stop();
    await opened?.liveness.stop().catch(() => undefined);
    await renderer?.close().catch(() => undefined);
    opened?.connection.disconnect();
  };
  timer = setTimeout(() => {
    finish(new Error('DOCUMENT_START_TIMEOUT'));
    void close();
  }, input.startupMs ?? STARTUP_MS);
  void bringUp(
    input,
    registry,
    () => closed,
    (live) => {
      opened = live;
    },
    (next) => {
      renderer = next;
    },
  ).then(
    () => finish(),
    (error: unknown) => {
      finish(error instanceof Error ? error : new Error('DOCUMENT_START_FAILED'));
      void close();
    },
  );
  return { started, stop, close };
}

/** النواة (السيرفر والموزّع) بتخلّص الأول. تعليق Chromium ما يأخرش `/ready`. */
export async function startCoreBeforeDocuments(input: CoreBeforeDocumentsInput): Promise<DocumentRendering> {
  await input.startCore();
  const documents = input.beginDocuments();
  if (input.isStopping()) await documents.close();
  return documents;
}

/**
 * قدرة اختيارية: فشل Chromium بيسجّل تحذير والوركر يكمل.
 * الإيقاف بيقفل طابور BullMQ الأول، وبعدين المتصفح.
 */
export async function startDocumentRendering(input: StartDocumentsInput): Promise<DocumentRendering> {
  const handle = beginDocumentRendering(input);
  try {
    await handle.started;
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
  return handle;
}
