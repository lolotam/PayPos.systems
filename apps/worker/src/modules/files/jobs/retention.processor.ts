import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { fileRetentionJob } from '@pospay/contracts';
import type { ClaimedEvent, DeliveryOutcome } from '@pospay/db';
import type { CleanupFiles } from '../use-cases/cleanup-files/cleanup-files.ts';

export function startRetentionProcessors(useCase: CleanupFiles, redisUrl: string, prefix = 'bull') {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null, enableOfflineQueue: false });
  connection.on('error', () => undefined);
  // تسجيل الجدول منتج bounded؛ اتصال العامل وحده يستمر في انتظار Redis.
  const producer = connection.duplicate({ maxRetriesPerRequest: 1, commandTimeout: 5000 });
  producer.on('error', () => undefined);
  const queues = (['abandoned', 'rejected'] as const).map((kind) => {
    const name = `files-cleanup-${kind}`,
      queue = new Queue(name, { connection: producer, prefix });
    queue.on('error', () => undefined);
    const worker = new Worker(
      name,
      async (job) => {
        const data = fileRetentionJob.safeParse(job.data);
        if (!data.success) throw new Error('FILE_JOB_INVALID');
        await useCase.execute(data.data.companyId, kind);
      },
      { connection, concurrency: 1, prefix },
    );
    worker.on('error', () => undefined);
    return { kind, queue, worker };
  });
  return {
    // يعاد تسجيل نفس الجدول عند إعادة تسليم outbox؛ الشركة هي الهوية الوحيدة في Redis.
    deliver: (event: ClaimedEvent) => registerSchedules(queues, event),
    ready: async () => {
      await Promise.all(queues.map(({ worker }) => worker.waitUntilReady()));
    },
    close: async () => {
      await Promise.all(
        queues.map(async ({ queue, worker }) => {
          await worker.close();
          await queue.close();
        }),
      );
      producer.disconnect();
      connection.disconnect();
    },
  };
}

async function registerSchedules(
  queues: readonly { kind: string; queue: Queue }[],
  event: ClaimedEvent,
): Promise<DeliveryOutcome> {
  try {
    const data = fileRetentionJob.parse({ companyId: event.companyId });
    for (const { kind, queue } of queues)
      await queue.upsertJobScheduler(
        `files-${kind}-${data.companyId}`,
        { every: 60 * 60 * 1000 },
        {
          name: 'cleanup',
          data,
          opts: {
            attempts: 8,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: true,
            removeOnFail: 100,
          },
        },
      );
    return { delivered: true };
  } catch {
    return { delivered: false, error: 'FILE_RETENTION_SCHEDULE_RETRY', retryInMs: 2000 };
  }
}
