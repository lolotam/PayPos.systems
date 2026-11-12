import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { z } from 'zod';
import { LEAVE_HISTORY_REPORT_CLEANUP_EVERY_MS, id } from '@pospay/contracts';
import type { ClaimedEvent, DeliveryOutcome } from '@pospay/db';
import type { CleanLeaveHistoryReports } from '../use-cases/clean-leave-history-reports/clean-leave-history-reports.ts';

export const LEAVE_HISTORY_REPORT_CLEANUP_QUEUE = 'leave-history-report-cleanup';
const cleanupJob = z.strictObject({ companyId: id });

export function startLeaveHistoryReportCleanupProcessor(
  useCase: CleanLeaveHistoryReports,
  redisUrl: string,
  prefix = 'bull',
) {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null, enableOfflineQueue: false });
  connection.on('error', () => undefined);
  const producer = connection.duplicate({ maxRetriesPerRequest: 1, commandTimeout: 5000 });
  producer.on('error', () => undefined);
  const queue = new Queue(LEAVE_HISTORY_REPORT_CLEANUP_QUEUE, { connection: producer, prefix });
  queue.on('error', () => undefined);
  const worker = new Worker(
    LEAVE_HISTORY_REPORT_CLEANUP_QUEUE,
    async (job) => useCase.execute(cleanupJob.parse(job.data).companyId),
    { connection, concurrency: 1, prefix },
  );
  worker.on('error', () => undefined);
  return {
    deliver: async (
      event: ClaimedEvent,
      next: () => Promise<DeliveryOutcome>,
    ): Promise<DeliveryOutcome> => {
      try {
        await queue.upsertJobScheduler(
          `${LEAVE_HISTORY_REPORT_CLEANUP_QUEUE}-${event.companyId}`,
          { every: LEAVE_HISTORY_REPORT_CLEANUP_EVERY_MS },
          {
            name: 'clean',
            data: cleanupJob.parse({ companyId: event.companyId }),
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
          error: 'LEAVE_HISTORY_REPORT_CLEANUP_SCHEDULE_RETRY',
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
