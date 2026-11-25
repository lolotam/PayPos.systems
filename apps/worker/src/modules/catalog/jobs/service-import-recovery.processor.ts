import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { z } from 'zod';
import type { RecoverServiceImports } from '../use-cases/recover-service-imports/recover-service-imports.ts';

export const SERVICE_IMPORT_RECOVERY_QUEUE = 'service-import-recovery';
const recoveryJob = z.strictObject({ companyId: z.uuid() });
// الخطأ الخام من قاعدة البيانات قد يحمل نص الاستعلام ومعاملاته فلا يكتبه BullMQ في failedReason؛ المحاولات تعيد المسح برسالة ثابتة.
const RETRY_MESSAGE = 'SERVICE_IMPORT_RECOVERY_RETRY';

export function startServiceImportRecoveryProcessor(
  useCase: RecoverServiceImports,
  redisUrl: string,
  prefix = 'bull',
) {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null, enableOfflineQueue: false });
  connection.on('error', () => undefined);
  const producer = connection.duplicate({ maxRetriesPerRequest: 1, commandTimeout: 5000 });
  producer.on('error', () => undefined);
  const queue = new Queue(SERVICE_IMPORT_RECOVERY_QUEUE, { connection: producer, prefix });
  queue.on('error', () => undefined);
  const worker = new Worker(
    SERVICE_IMPORT_RECOVERY_QUEUE,
    async (job) => {
      const { companyId } = recoveryJob.parse(job.data);
      await useCase.execute(companyId).catch(() => {
        throw new Error(RETRY_MESSAGE);
      });
    },
    { connection, concurrency: 1, prefix },
  );
  worker.on('error', () => undefined);
  return {
    register: async (companyId: string): Promise<void> => {
      await queue.upsertJobScheduler(
        `${SERVICE_IMPORT_RECOVERY_QUEUE}-${companyId}`,
        { every: 60 * 1000 },
        {
          name: 'recover',
          data: recoveryJob.parse({ companyId }),
          opts: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: true,
            removeOnFail: 100,
          },
        },
      );
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
