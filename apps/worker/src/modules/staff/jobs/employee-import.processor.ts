import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { employeeImportCommitJob } from '@pospay/contracts';
import type { ClaimedEvent, DeliveryOutcome } from '@pospay/db';
import type { CommitEmployeeImport } from '../use-cases/commit-employee-import/commit-employee-import.ts';

export const EMPLOYEE_IMPORT_QUEUE = 'employee-import-commit';

// ADR-0018: النشر إلى Redis خارج معاملة outbox؛ jobId ثابت يزيل أثر إعادة التسليم.
export function startEmployeeImportProcessor(
  useCase: CommitEmployeeImport,
  redisUrl: string,
  prefix = 'bull',
) {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null, enableOfflineQueue: false });
  connection.on('error', () => undefined);
  const producer = connection.duplicate({ maxRetriesPerRequest: 1, commandTimeout: 5000 });
  producer.on('error', () => undefined);
  const queue = new Queue(EMPLOYEE_IMPORT_QUEUE, { connection: producer, prefix });
  queue.on('error', () => undefined);
  const worker = new Worker(
    EMPLOYEE_IMPORT_QUEUE,
    async (job) => {
      const parsed = employeeImportCommitJob.safeParse(job.data);
      if (!parsed.success) throw new Error('EMPLOYEE_IMPORT_JOB_INVALID');
      const { companyId, previewId } = parsed.data;
      try {
        await useCase.execute(companyId, previewId);
      } catch (error) {
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
        const data = employeeImportCommitJob.parse({
          companyId: event.companyId,
          previewId: (event.payload as { preview_id?: string }).preview_id,
        });
        await queue.add('commit', data, {
          jobId: event.id,
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: true,
          removeOnFail: 100,
        });
        return { delivered: true };
      } catch {
        return { delivered: false, error: 'EMPLOYEE_IMPORT_QUEUE_RETRY', retryInMs: 2000 };
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
