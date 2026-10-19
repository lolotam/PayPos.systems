import { UnrecoverableError, type Job } from 'bullmq';
import {
  documentRenderJob,
  type DocumentRenderErrorCode,
  type DocumentRenderJob,
} from '@pospay/contracts';
import {
  assertHtmlWithinLimit,
  DocumentRenderTimeoutError,
  DocumentRendererUnavailableError,
  DocumentTooLargeError,
  type DocumentRenderer,
} from '@pospay/documents';
import type { Logger } from '@pospay/observability';
import type { Redis } from 'ioredis';

import { DocumentKindUnknownError } from './kind-error.ts';
import type { DocumentSourceRegistry } from './source-registry.ts';
import { markFailed, markRendering, storeReady } from './status-store.ts';

const JOB_DEADLINE_MS = 30_000;

export interface EpochClock {
  now(): number;
}

export interface ProcessDocumentDeps {
  readonly redis: Redis;
  readonly registry: DocumentSourceRegistry;
  readonly renderer: DocumentRenderer;
  readonly clock: EpochClock;
  readonly logger: Logger;
  /** مهلة الوظيفة كلها، من قبل تحميل المصدر. الاختبارات بتقصّرها. */
  readonly deadlineMs?: number;
}

/** BullMQ 6.2 بيخزّن atm بعد نهاية المحاولة، فالمحاولة الجارية لسه مش معدودة. */
export function isFinalAttempt(job: Job): boolean {
  return job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
}

/**
 * حدث failed بيتبعت بعد moveToFailed. finishedOn بيتكتب بس لما مفيش إعادة؛
 * attemptsMade في الحدث ده يبقى زايد واحدة عن اللي المعالج شافها.
 */
export function isTerminalJobFailure(job: Job): boolean {
  return typeof job.finishedOn === 'number';
}

function errorCode(error: unknown): DocumentRenderErrorCode {
  if (error instanceof DocumentKindUnknownError) return 'DOCUMENT_KIND_UNKNOWN';
  if (error instanceof DocumentTooLargeError) return 'DOCUMENT_TOO_LARGE';
  if (error instanceof DocumentRenderTimeoutError) return 'DOCUMENT_RENDER_TIMEOUT';
  return 'DOCUMENT_RENDER_FAILED';
}

function armDeadline(ms: number): { signal: AbortSignal; stop: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, stop: () => clearTimeout(timer) };
}

function untilAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new DocumentRenderTimeoutError());
  return new Promise((resolve, reject) => {
    const onAbort = (): void => reject(new DocumentRenderTimeoutError());
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

async function renderHtml(
  deps: ProcessDocumentDeps,
  companyId: string,
  renderId: string,
  kind: string,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const source = deps.registry.get(kind);
  if (source === undefined) throw new DocumentKindUnknownError();
  if (!deps.renderer.isAvailable()) throw new DocumentRendererUnavailableError();
  const html = await untilAbort(source.load(companyId, renderId, signal), signal);
  assertHtmlWithinLimit(html);
  return untilAbort(deps.renderer.render(html, { signal }), signal);
}

function logOutcome(
  logger: Logger,
  fields: {
    readonly company_id: string;
    readonly render_id: string;
    readonly kind: string;
    readonly state: 'READY' | 'FAILED' | 'SKIPPED';
    readonly duration_ms: number;
    readonly error_code?: DocumentRenderErrorCode;
  },
): void {
  const record: Record<string, string | number> = {
    company_id: fields.company_id,
    render_id: fields.render_id,
    kind: fields.kind,
    state: fields.state,
    duration_ms: fields.duration_ms,
  };
  if (fields.error_code !== undefined) record['error_code'] = fields.error_code;
  logger.info(record, 'document render');
}

function skip(
  deps: ProcessDocumentDeps,
  data: DocumentRenderJob,
  started: number,
): void {
  logOutcome(deps.logger, {
    company_id: data.company_id,
    render_id: data.render_id,
    kind: data.kind,
    state: 'SKIPPED',
    duration_ms: deps.clock.now() - started,
  });
}

async function failFinal(
  job: Job,
  deps: ProcessDocumentDeps,
  data: DocumentRenderJob,
  started: number,
  error: unknown,
): Promise<void> {
  const code = errorCode(error);
  if (isFinalAttempt(job)) {
    await markFailed(deps.redis, data.company_id, data.render_id, code);
    logOutcome(deps.logger, {
      company_id: data.company_id,
      render_id: data.render_id,
      kind: data.kind,
      state: 'FAILED',
      duration_ms: deps.clock.now() - started,
      error_code: code,
    });
  }
  throw new Error(code, { cause: error });
}

/**
 * بيخلّص وظيفة رندر واحدة: حالة، ثم HTML، ثم بايتات بنص قصير.
 * الفشل النهائي بس هو اللي بيتكتب FAILED؛ المحاولة الأولى بتترمي عشان BullMQ يعيد.
 */
export async function processDocumentJob(job: Job, deps: ProcessDocumentDeps): Promise<void> {
  const started = deps.clock.now();
  const parsed = documentRenderJob.safeParse(job.data);
  if (!parsed.success) throw new UnrecoverableError('DOCUMENT_JOB_INVALID');
  const deadline = armDeadline(deps.deadlineMs ?? JOB_DEADLINE_MS);
  try {
    await runGuarded(job, deps, parsed.data, started, deadline.signal);
  } finally {
    deadline.stop();
  }
}

async function runGuarded(
  job: Job,
  deps: ProcessDocumentDeps,
  data: DocumentRenderJob,
  started: number,
  signal: AbortSignal,
): Promise<void> {
  try {
    const rendering = await markRendering(deps.redis, data.company_id, data.render_id);
    if (!rendering) {
      skip(deps, data, started);
      return;
    }
    const pdf = await renderHtml(deps, data.company_id, data.render_id, data.kind, signal);
    const stored = await storeReady(deps.redis, data.company_id, data.render_id, pdf);
    if (!stored) {
      skip(deps, data, started);
      return;
    }
    logOutcome(deps.logger, {
      company_id: data.company_id,
      render_id: data.render_id,
      kind: data.kind,
      state: 'READY',
      duration_ms: deps.clock.now() - started,
    });
  } catch (error) {
    await failFinal(job, deps, data, started, error);
  }
}

/** فشل BullMQ من غير ما المعالج يتنده، زي تجاوز maxStalledCount. الحالة بتتقفل لو الانتقال مسموح. */
export async function recordExternalJobFailure(
  job: Job,
  deps: Pick<ProcessDocumentDeps, 'redis' | 'logger' | 'clock'>,
): Promise<void> {
  if (!isTerminalJobFailure(job)) return;
  const parsed = documentRenderJob.safeParse(job.data);
  if (!parsed.success) return;
  const { company_id, render_id, kind } = parsed.data;
  const failed = await markFailed(deps.redis, company_id, render_id, 'DOCUMENT_RENDER_FAILED');
  if (!failed) return;
  const processedOn = job.processedOn ?? deps.clock.now();
  logOutcome(deps.logger, {
    company_id,
    render_id,
    kind,
    state: 'FAILED',
    duration_ms: deps.clock.now() - processedOn,
    error_code: 'DOCUMENT_RENDER_FAILED',
  });
}
