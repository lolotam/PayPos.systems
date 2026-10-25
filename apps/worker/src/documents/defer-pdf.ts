import { documentRenderJob } from '@pospay/contracts';
import { DelayedError, type Job } from 'bullmq';

import type { DocumentSourceRegistry } from './source-registry.ts';

/** حالة إقلاع المتصفح: الطابور شغّال بس المتصفح لسه بيقوم. */
export interface RendererStartup {
  starting: boolean;
}

/** مهلة التأجيل القصيرة: بتتنادى مع كل فحص لحد ما المتصفح يطلع. */
export const PDF_DEFER_MS = 1_000;

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
  if (!startup.starting) return;
  const parsed = documentRenderJob.safeParse(job.data);
  if (!parsed.success) return;
  const source = registry.get(parsed.data.kind);
  if (source === undefined || source.output === 'bytes') return;
  await job.moveToDelayed(Date.now() + PDF_DEFER_MS, token);
  throw new DelayedError();
}
