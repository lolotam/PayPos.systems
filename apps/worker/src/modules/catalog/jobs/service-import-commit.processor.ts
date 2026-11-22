import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { serviceImportCommitJob } from '@pospay/contracts';
import type { ClaimedEvent, DeliveryOutcome } from '@pospay/db';
import type { CommitServiceImport } from '../use-cases/commit-service-import/commit-service-import.ts';

export const SERVICE_IMPORT_QUEUE = 'service-import-commit';

// FR-009: محاولة أولى وثلاث إعادات للفشل غير المتوقع، ثم فشل تثبيت مُسمّى شرطي على الطلب الحي فقط.
const SERVICE_IMPORT_ATTEMPTS = 4;

// ADR-0018: النشر إلى Redis خارج معاملة outbox؛ jobId ثابت يزيل أثر إعادة التسليم.
export function startServiceImportProcessor(
  useCase: CommitServiceImport,
  redisUrl: string,
  prefix = 'bull',
) {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null, enableOfflineQueue: false });
  connection.on('error', () => undefined);
  const producer = connection.duplicate({ maxRetriesPerRequest: 1, commandTimeout: 5000 });
  producer.on('error', () => undefined);
  const queue = new Queue(SERVICE_IMPORT_QUEUE, { connection: producer, prefix });
  queue.on('error', () => undefined);
  const worker = new Worker(
    SERVICE_IMPORT_QUEUE,
    async (job) => {
      const parsed = serviceImportCommitJob.safeParse(job.data);
      if (!parsed.success) throw new Error('SERVICE_IMPORT_JOB_INVALID');
      const { companyId, previewId } = parsed.data;
      try {
        await useCase.execute(companyId, previewId);
      } catch (error) {
        // آخر محاولة للفشل غير المتوقع تُنهي الطلب الحي برمز التثبيت الفاشل بعد تراجع المعاملة (FR-009).
        if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1))
          await useCase.fail(companyId, previewId);
        throw error;
      }
    },
    { connection, concurrency: 1, prefix },
  );
  worker.on('error', () => undefined);
  return {
    deliver: async (event: ClaimedEvent): Promise<DeliveryOutcome> => {
      try {
        const data = serviceImportCommitJob.parse({
          companyId: event.companyId,
          previewId: (event.payload as { preview_id?: string }).preview_id,
        });
        await queue.add('commit', data, {
          jobId: event.id,
          attempts: SERVICE_IMPORT_ATTEMPTS,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: true,
          removeOnFail: 100,
        });
        return { delivered: true };
      } catch {
        return { delivered: false, error: 'SERVICE_IMPORT_QUEUE_RETRY', retryInMs: 2000 };
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
