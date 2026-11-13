import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { z } from 'zod';
import type { RecoverPackageSales } from '../use-cases/recover-package-sales/recover-package-sales.ts';

export const PACKAGE_SALE_RECOVERY_QUEUE = 'package-sale-recovery';
const recoveryJob = z.strictObject({ companyId: z.uuid() });

export function startPackageSaleRecoveryProcessor(
  useCase: RecoverPackageSales,
  redisUrl: string,
  prefix = 'bull',
) {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null, enableOfflineQueue: false });
  connection.on('error', () => undefined);
  const producer = connection.duplicate({ maxRetriesPerRequest: 1, commandTimeout: 5000 });
  producer.on('error', () => undefined);
  const queue = new Queue(PACKAGE_SALE_RECOVERY_QUEUE, { connection: producer, prefix });
  queue.on('error', () => undefined);
  const worker = new Worker(
    PACKAGE_SALE_RECOVERY_QUEUE,
    async (job) => useCase.execute(recoveryJob.parse(job.data).companyId),
    { connection, concurrency: 1, prefix },
  );
  worker.on('error', () => undefined);
  const registeredCompanies = new Set<string>();
  return {
    register: async (companyId: string): Promise<void> => {
      if (registeredCompanies.has(companyId)) return;
      await queue.upsertJobScheduler(
        `${PACKAGE_SALE_RECOVERY_QUEUE}-${companyId}`,
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
      registeredCompanies.add(companyId);
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
