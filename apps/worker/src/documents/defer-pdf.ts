import { documentRenderJob } from '@pospay/contracts';
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

function pruneExpired(deadlines: Map<string, number>, now: number): void {
  if (deadlines.size < 256) return;
  for (const [key, until] of deadlines) {
    if (now >= until) deadlines.delete(key);
  }
}

/**
 * PDF بيتأجل من غير ما يستهلك محاولة BullMQ طالما المتصفح لسه بيقوم.
 * نافذة إعادة المحاولة (٥ ثواني) أقصر من مهلة إقلاع المتصفح، فالفشل كان بيسقط الطلب.
 */
export async function deferPdfWhileStarting(
  job: Job,
  token: string | undefined,
  startup: RendererStartup,
  registry: DocumentSourceRegistry,
): Promise<void> {
  const parsed = documentRenderJob.safeParse(job.data);
  const jobKey =
    typeof job.id === 'string' && job.id.length > 0
      ? job.id
      : parsed.success
        ? parsed.data.render_id
        : undefined;
  const now = Date.now();
  if (!startup.starting || now >= startup.deadlineAt) {
    if (jobKey !== undefined) startup.jobDeadlines?.delete(jobKey);
    return;
  }
  if (!parsed.success) return;
  const source = registry.get(parsed.data.kind);
  if (source === undefined || source.output === 'bytes') return;
  if (jobKey !== undefined && startup.jobDeadlines !== undefined) {
    let jobDeadline = startup.jobDeadlines.get(jobKey);
    if (jobDeadline === undefined) {
      pruneExpired(startup.jobDeadlines, now);
      jobDeadline = Math.min(startup.deadlineAt, now + PDF_DEFER_WINDOW_MS);
      startup.jobDeadlines.set(jobKey, jobDeadline);
    }
    if (now >= jobDeadline) {
      startup.jobDeadlines.delete(jobKey);
      return;
    }
  }
  await job.moveToDelayed(now + PDF_DEFER_MS, token);
  throw new DelayedError();
}
