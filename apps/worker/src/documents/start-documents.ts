import { DOCUMENTS_RENDER_QUEUE } from '@pospay/contracts';
import {
  rendererFailureText,
  type DocumentRenderer,
  type RendererOptions,
} from '@pospay/documents';
import type { Logger } from '@pospay/observability';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';

import { startRendererLiveness, type RendererLiveness } from './liveness.ts';
import type { EpochClock } from './process-job.ts';
import { DocumentSourceRegistry } from './source-registry.ts';
import { trackDocumentStartup, type AttemptBinder } from './startup-session.ts';

const LOCK_MS = 45_000;
const STARTUP_MS = 30_000;
const RETRY_DELAYS_MS = [5_000, 15_000, 60_000] as const;

export interface DocumentRendering {
  stop(force?: boolean): Promise<void>;
  close(): Promise<void>;
  readonly registry: DocumentSourceRegistry;
  /** بيتكمّل لما الطابور يبقى جاهز، أو لما الإيقاف يقفل الإقلاع. */
  readonly started: Promise<void>;
}

export interface StartDocumentsInput {
  readonly redis: Redis;
  readonly redisUrl: string;
  readonly logger: Logger;
  readonly clock: EpochClock;
  readonly renderer?: DocumentRenderer;
  readonly createRenderer?: () => DocumentRenderer | Promise<DocumentRenderer>;
  readonly browserFactory?: NonNullable<RendererOptions['factory']>;
  readonly registry?: DocumentSourceRegistry;
  readonly prefix?: string;
  readonly livenessIntervalMs?: number;
  readonly startupMs?: number;
  readonly retryDelaysMs?: readonly number[];
  readonly sleep?: (ms: number) => Promise<void>;
  readonly lockDurationMs?: number;
  readonly stalledIntervalMs?: number;
  readonly maxStalledCount?: number;
  readonly isStopping?: () => boolean;
}

export interface CoreBeforeDocumentsInput {
  startCore(): Promise<void>;
  beginDocuments(): DocumentRendering;
  isStopping(): boolean;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function logUnavailable(logger: Logger, reason: string, error?: unknown): void {
  const failure = error === undefined ? undefined : rendererFailureText(error);
  logger.warn(
    {
      capability: { name: 'DOCUMENTS', state: 'UNAVAILABLE', reason },
      ...(failure === undefined
        ? {}
        : { error_class: failure.error_class, error_message: failure.error_message }),
    },
    'document renderer unavailable',
  );
}

function bindAvailableLog(logger: Logger, renderer: DocumentRenderer): void {
  renderer.onAvailable(() => {
    logger.info(
      { capability: { name: 'DOCUMENTS', state: 'AVAILABLE' } },
      'document renderer available',
    );
  });
}

async function openRenderer(input: StartDocumentsInput): Promise<DocumentRenderer> {
  if (input.createRenderer !== undefined) {
    const renderer = await input.createRenderer();
    bindAvailableLog(input.logger, renderer);
    return renderer;
  }
  if (input.renderer !== undefined) return input.renderer;
  const { PlaywrightDocumentRenderer } = await import('@pospay/documents');
  const renderer = new PlaywrightDocumentRenderer({
    ...(input.browserFactory === undefined ? {} : { factory: input.browserFactory }),
    onLaunchError: (error) => logUnavailable(input.logger, 'LAUNCH_FAILED', error),
  });
  bindAvailableLog(input.logger, renderer);
  return renderer;
}

function openQueueConnection(redisUrl: string): Redis {
  const connection = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
  });
  connection.on('error', () => undefined);
  return connection;
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
        lockDuration: input.lockDurationMs ?? LOCK_MS,
        ...(input.stalledIntervalMs === undefined ? {} : { stalledInterval: input.stalledIntervalMs }),
        ...(input.maxStalledCount === undefined ? {} : { maxStalledCount: input.maxStalledCount }),
        ...(input.prefix === undefined ? {} : { prefix: input.prefix }),
      },
    );
    worker.on('error', (error: Error) => logUnavailable(input.logger, 'QUEUE_FAILED', error));
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

function halted(input: StartDocumentsInput, attempt: AttemptBinder): boolean {
  return attempt.cancelled() || input.isStopping?.() === true;
}

async function bringUp(
  input: StartDocumentsInput,
  registry: DocumentSourceRegistry,
  attempt: AttemptBinder,
): Promise<boolean> {
  let liveness: RendererLiveness | undefined;
  try {
    if (halted(input, attempt)) return false;
    const renderer = await openRenderer(input);
    attempt.setRenderer(renderer);
    if (halted(input, attempt)) return false;
    await renderer.start();
    if (halted(input, attempt)) return false;
    liveness = await startRendererLiveness({
      redis: input.redis,
      renderer,
      ...(input.livenessIntervalMs === undefined ? {} : { intervalMs: input.livenessIntervalMs }),
    });
    if (halted(input, attempt)) return false;
    const opened = await openWorker(input, registry, renderer);
    if (halted(input, attempt)) {
      await opened.worker.close().catch(() => undefined);
      opened.connection.disconnect();
      return false;
    }
    attempt.setLive({ ...opened, liveness });
    liveness = undefined;
    return true;
  } finally {
    await liveness?.stop().catch(() => undefined);
  }
}

/**
 * القدرة بتترجع فورًا. إقلاع Chromium وRedis بيتأجل لو بطّأ، والإيقاف بيقفل المحاولة.
 */
export function beginDocumentRendering(input: StartDocumentsInput): DocumentRendering {
  const registry = input.registry ?? new DocumentSourceRegistry();
  if (input.renderer !== undefined) bindAvailableLog(input.logger, input.renderer);
  const runtime = trackDocumentStartup({
    startupMs: input.startupMs ?? STARTUP_MS,
    retryDelaysMs: input.retryDelaysMs ?? RETRY_DELAYS_MS,
    sleep: input.sleep ?? delay,
    stopped: () => input.isStopping?.() === true,
    onFailed: (error) => logUnavailable(input.logger, 'SETUP_FAILED', error),
    run: (attempt) => bringUp(input, registry, attempt),
  });
  return {
    stop: (force) => runtime.stop(force ?? false),
    close: () => runtime.close(),
    registry,
    started: runtime.started,
  };
}

/** النواة (السيرفر والموزّع) بتخلّص الأول. تعليق Chromium ما يأخرش `/ready`. */
export async function startCoreBeforeDocuments(input: CoreBeforeDocumentsInput): Promise<DocumentRendering> {
  await input.startCore();
  const documents = input.beginDocuments();
  if (input.isStopping()) await documents.close();
  return documents;
}

/**
 * قدرة اختيارية: فشل Chromium بيتسجل والإقلاع بيعيد المحاولة، والوركر يكمل.
 * الإيقاف بيقفل طابور BullMQ الأول، وبعدين المتصفح.
 */
export async function startDocumentRendering(input: StartDocumentsInput): Promise<DocumentRendering> {
  const handle = beginDocumentRendering(input);
  await handle.started;
  return handle;
}
