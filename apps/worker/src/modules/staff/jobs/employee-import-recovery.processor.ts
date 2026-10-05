import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { z } from 'zod';
import type { ClaimedEvent, DeliveryOutcome } from '@pospay/db';
import type { RecoverEmployeeImports } from '../use-cases/recover-employee-imports/recover-employee-imports.ts';

export const EMPLOYEE_IMPORT_RECOVERY_QUEUE = 'employee-import-recovery';
const recoveryJob = z.object({ companyId: z.uuid() }).strict();

export function startEmployeeImportRecoveryProcessor(
  useCase: RecoverEmployeeImports,
  redisUrl: string,
  prefix = 'bull',
) {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null, enableOfflineQueue: false });
  connection.on('error', () => undefined);
  const producer = connection.duplicate({ maxRetriesPerRequest: 1, commandTimeout: 5000 });
  producer.on('error', () => undefined);
  const queue = new Queue(EMPLOYEE_IMPORT_RECOVERY_QUEUE, { connection: producer, prefix });
  queue.on('error', () => undefined);
  const worker = new Worker(
    EMPLOYEE_IMPORT_RECOVERY_QUEUE,
    async (job) => useCase.execute(recoveryJob.parse(job.data).companyId),
    { connection, concurrency: 1, prefix },
  );
  worker.on('error', () => undefined);
  return {
    // نفس اكتشاف PR 24 / ADR-0022: لا قارئ شركات عالمي؛ نسجل الجدول قبل إقرار حدث الطلب.
    deliver: async (
      event: ClaimedEvent,
      next: () => Promise<DeliveryOutcome>,
    ): Promise<DeliveryOutcome> => {
      try {
        await queue.upsertJobScheduler(
          `${EMPLOYEE_IMPORT_RECOVERY_QUEUE}-${event.companyId}`,
          { every: 60 * 1000 },
          {
            name: 'recover',
            data: recoveryJob.parse({ companyId: event.companyId }),
            opts: {
              attempts: 3,
              backoff: { type: 'exponential', delay: 2000 },
              removeOnComplete: true,
              removeOnFail: 100,
            },
          },
        );
      } catch {
        return {
          delivered: false,
          error: 'EMPLOYEE_IMPORT_RECOVERY_SCHEDULE_RETRY',
          retryInMs: 2000,
        };
      }
      return next();
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
