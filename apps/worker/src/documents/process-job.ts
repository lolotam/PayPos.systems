import { UnrecoverableError, type Job } from 'bullmq';
import {
  documentRenderJob,
  type DocumentRenderErrorCode,
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

export interface EpochClock {
  now(): number;
}

export interface ProcessDocumentDeps {
  readonly redis: Redis;
  readonly registry: DocumentSourceRegistry;
  readonly renderer: DocumentRenderer;
  readonly clock: EpochClock;
  readonly logger: Logger;
}

/** BullMQ 6.2 بيخزّن atm بعد نهاية المحاولة، فالمحاولة الجارية لسه مش معدودة. */
export function isFinalAttempt(job: Job): boolean {
  return job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
}

function errorCode(error: unknown): DocumentRenderErrorCode {
  if (error instanceof DocumentKindUnknownError) return 'DOCUMENT_KIND_UNKNOWN';
  if (error instanceof DocumentTooLargeError) return 'DOCUMENT_TOO_LARGE';
  if (error instanceof DocumentRenderTimeoutError) return 'DOCUMENT_RENDER_TIMEOUT';
  return 'DOCUMENT_RENDER_FAILED';
}

async function renderHtml(deps: ProcessDocumentDeps, companyId: string, renderId: string, kind: string) {
  const source = deps.registry.get(kind);
  if (source === undefined) throw new DocumentKindUnknownError();
  if (!deps.renderer.isAvailable()) throw new DocumentRendererUnavailableError();
  const html = await source.load(companyId, renderId);
  assertHtmlWithinLimit(html);
  return deps.renderer.render(html);
}

function logOutcome(
  logger: Logger,
  fields: {
    readonly company_id: string;
    readonly render_id: string;
    readonly kind: string;
    readonly state: 'READY' | 'FAILED';
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

/**
 * بيخلّص وظيفة رندر واحدة: حالة، ثم HTML، ثم بايتات بنص قصير.
 * الفشل النهائي بس هو اللي بيتكتب FAILED؛ المحاولة الأولى بتترمي عشان BullMQ يعيد.
 */
export async function processDocumentJob(job: Job, deps: ProcessDocumentDeps): Promise<void> {
  const started = deps.clock.now();
  const parsed = documentRenderJob.safeParse(job.data);
  if (!parsed.success) throw new UnrecoverableError('DOCUMENT_JOB_INVALID');
  const { company_id, render_id, kind } = parsed.data;
  await markRendering(deps.redis, company_id, render_id);
  try {
    const pdf = await renderHtml(deps, company_id, render_id, kind);
    await storeReady(deps.redis, company_id, render_id, pdf);
    logOutcome(deps.logger, {
      company_id,
      render_id,
      kind,
      state: 'READY',
      duration_ms: deps.clock.now() - started,
    });
  } catch (error) {
    const code = errorCode(error);
    if (isFinalAttempt(job)) {
      await markFailed(deps.redis, company_id, render_id, code);
      logOutcome(deps.logger, {
        company_id,
        render_id,
        kind,
        state: 'FAILED',
        duration_ms: deps.clock.now() - started,
        error_code: code,
      });
    }
    throw new Error(code, { cause: error });
  }
}
