import { documentRenderJob } from '@pospay/contracts';
import type { DocumentRenderer } from '@pospay/documents';
import { DelayedError, type Job } from 'bullmq';

import type { DocumentSourceRegistry } from './source-registry.ts';

/** حالة إقلاع المتصفح: الطابور شغّال بس المتصفح لسه بيقوم. التأجيل لحد ما يطلع أو يخلص السقف. */
export interface RendererStartup {
  starting: boolean;
  deadlineAt: number;
  /** سقف تأجيل لكل وظيفة بحيث التقطيع المتكرر ما يمدّش سقفها من جديد. */
  readonly jobDeadlines?: Map<string, number>;
}

/** مهلة التأجيل القصيرة: بتتنادى مع كل فحص لحد ما المتصفح يطلع. */
export const PDF_DEFER_MS = 1_000;

/** سقف التأجيل: متصفح ما بيطلعش ما يأجّلش PDF للأبد؛ بعد السقف بيمشي المسار العادي. */
export const PDF_DEFER_WINDOW_MS = 120_000;

/** احتفاظ بسقف الوظيفة المنتهي عشر دقايق عشان إعادة المحاولة والتقطيع ما يجددوش السقف، ويمسح بس لما يبرد. */
export const PDF_DEFER_RETENTION_MS = 600_000;

function jobKeyOf(job: Job, parsedData?: { readonly render_id: string }): string | undefined {
  if (typeof job.id === 'string' && job.id.length > 0) return job.id;
  return parsedData?.render_id;
}

function pruneExpired(deadlines: Map<string, number>, now: number): void {
  if (deadlines.size < 256) return;
  for (const [key, until] of deadlines) {
    if (now >= until + PDF_DEFER_RETENTION_MS) deadlines.delete(key);
  }
}

function persistedDeadlineOf(job: Job): number | undefined {
  const progress = (job as { readonly progress?: unknown }).progress;
  if (typeof progress === 'number' && Number.isFinite(progress) && progress > 0) {
    return progress;
  }
  if (typeof progress === 'object' && progress !== null && 'deferDeadlineAt' in progress) {
    const value = (progress as { readonly deferDeadlineAt?: unknown }).deferDeadlineAt;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  }
  return undefined;
}

async function persistJobDeadline(job: Job, deadlineAt: number): Promise<void> {
  const payload = { deferDeadlineAt: deadlineAt };
  (job as { progress?: unknown }).progress = payload;
  if (typeof job.updateProgress === 'function') {
    await job.updateProgress(payload);
  }
}

/** يمسح سجل سقف التأجيل لو انتهت الوظيفة بالنجاح أو الفشل النهائي. */
export function clearJobDeferralDeadline(job: Job, startup: RendererStartup): void {
  if (startup.jobDeadlines === undefined) return;
  const parsed = documentRenderJob.safeParse(job.data);
  const jobKey = jobKeyOf(job, parsed.success ? parsed.data : undefined);
  if (jobKey !== undefined) startup.jobDeadlines.delete(jobKey);
}

/**
 * PDF بيتأجل من غير ما يستهلك محاولة BullMQ طالما المتصفح لسه بيقوم.
 * نافذة إعادة المحاولة ممكن تنتهي قبل ما المتصفح يقوم، فالتأجيل بيحمي الطلب بسقف محدد.
 */
export async function deferPdfWhileStarting(
  job: Job,
  token: string | undefined,
  startup: RendererStartup,
  registry: DocumentSourceRegistry,
): Promise<void> {
  const parsed = documentRenderJob.safeParse(job.data);
  const jobKey = jobKeyOf(job, parsed.success ? parsed.data : undefined);
  const now = Date.now();
  if (!startup.starting) return;
  if (!parsed.success) return;
  const source = registry.get(parsed.data.kind);
  if (source === undefined || source.output === 'bytes') return;
  const persisted = persistedDeadlineOf(job);
  const inMemory = jobKey !== undefined ? startup.jobDeadlines?.get(jobKey) : undefined;
  const existing = Math.min(inMemory ?? Number.POSITIVE_INFINITY, persisted ?? Number.POSITIVE_INFINITY);
  const jobDeadline = Number.isFinite(existing)
    ? existing
    : Math.min(startup.deadlineAt, now + PDF_DEFER_WINDOW_MS);
  const effectiveDeadline = Math.min(jobDeadline, startup.deadlineAt);
  if (now >= effectiveDeadline) {
    if (jobKey !== undefined && startup.jobDeadlines !== undefined) {
      startup.jobDeadlines.set(jobKey, Math.min(jobDeadline, now));
    }
    return;
  }
  if (jobKey !== undefined && startup.jobDeadlines !== undefined) {
    if (inMemory === undefined) pruneExpired(startup.jobDeadlines, now);
    startup.jobDeadlines.set(jobKey, jobDeadline);
  }
  if (persisted === undefined || jobDeadline < persisted) {
    await persistJobDeadline(job, jobDeadline);
  }
  await job.moveToDelayed(Math.min(now + PDF_DEFER_MS, effectiveDeadline), token);
  throw new DelayedError();
}

/** يربط إقلاع وتعطّل المتصفح بسقف تأجيل PDF أثناء التشغيل والإنعاش. */
export function armRecoveryDeferral(
  renderer: DocumentRenderer,
  cancelled: () => boolean,
  startup: RendererStartup,
): void {
  renderer.onAvailable(() => {
    if (!cancelled()) startup.starting = false;
  });
  renderer.onUnavailable(() => {
    if (cancelled() || startup.starting) return;
    startup.starting = true;
    startup.deadlineAt = Date.now() + PDF_DEFER_WINDOW_MS;
  });
  if (!cancelled() && renderer.isAvailable()) startup.starting = false;
}
