import { Queue, Worker, DelayedError, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { packageImportPreviewJob, packageImportPreviewRequested } from '@pospay/contracts';
import type { ClaimedEvent, DeliveryOutcome } from '@pospay/db';
import type { ExecutePackagePreview } from '../use-cases/execute-package-preview/execute-package-preview.ts';

export const PACKAGE_PREVIEW_QUEUE = 'package-import-preview';
const FINALIZING_FAILURE = 'finalizing-preview-failure';

// المرحلة محفوظة في progress، مش payload؛ إعادة التشغيل تكمّل تثبيت الفشل من غير قراءة الملف تاني.
function previewHandler(useCase: ExecutePackagePreview) {
  return async (job: Job, token?: string) => {
    const parsed = packageImportPreviewJob.safeParse(job.data);
    if (!parsed.success) throw new Error('PACKAGE_PREVIEW_JOB_INVALID');
    const { companyId, previewId } = parsed.data;
    if (job.progress === FINALIZING_FAILURE)
      return persistFailure(useCase, job, token, companyId, previewId);
    try {
      await useCase.execute(companyId, previewId);
    } catch (error) {
      if (job.attemptsMade + 1 < (job.opts.attempts ?? 1)) throw error;
      await job.updateProgress(FINALIZING_FAILURE);
      return persistFailure(useCase, job, token, companyId, previewId);
    }
  };
}

async function persistFailure(
  useCase: ExecutePackagePreview,
  job: Job,
  token: string | undefined,
  companyId: string,
  previewId: string,
) {
  try {
    await useCase.fail(companyId, previewId);
  } catch {
    // DelayedError لا يستهلك محاولة جديدة؛ الأمر المقبول يفضل قابلًا للإعادة لحد رجوع قاعدة البيانات.
    await job.moveToDelayed(Date.now() + 2000, token);
    throw new DelayedError();
  }
}

// ADR-0018: النشر إلى Redis خارج معاملة outbox؛ jobId ثابت يزيل أثر إعادة التسليم.
export function startPackagePreviewProcessor(
  useCase: ExecutePackagePreview,
  redisUrl: string,
  prefix = 'bull',
) {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null, enableOfflineQueue: false });
  connection.on('error', () => undefined);
  const producer = connection.duplicate({ maxRetriesPerRequest: 1, commandTimeout: 5000 });
  producer.on('error', () => undefined);
  const queue = new Queue(PACKAGE_PREVIEW_QUEUE, { connection: producer, prefix });
  queue.on('error', () => undefined);
  const worker = new Worker(PACKAGE_PREVIEW_QUEUE, previewHandler(useCase), {
    connection,
    concurrency: 1,
    prefix,
  });
  worker.on('error', () => undefined);
  return {
    deliver: async (event: ClaimedEvent): Promise<DeliveryOutcome> => {
      const data = packageImportPreviewJob.safeParse({
        companyId: event.companyId,
        previewId: event.aggregateId,
      });
      const payload = packageImportPreviewRequested.safeParse(event.payload);
      if (
        !data.success ||
        !payload.success ||
        payload.data.preview_id.toLowerCase() !== data.data.previewId.toLowerCase()
      )
        return { delivered: false, error: 'PACKAGE_PREVIEW_EVENT_INVALID', retryInMs: null };
      try {
        await queue.add('preview', data.data, {
          jobId: event.id,
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: true,
          removeOnFail: 100,
        });
        return { delivered: true };
      } catch {
        return { delivered: false, error: 'PACKAGE_PREVIEW_QUEUE_RETRY', retryInMs: 2000 };
      }
    },
    ready: () => worker.waitUntilReady().then(() => undefined),
    close: async () => {
      await worker.close();
      await queue.close();
      producer.disconnect();
      connection.disconnect();
    },
  };
}
