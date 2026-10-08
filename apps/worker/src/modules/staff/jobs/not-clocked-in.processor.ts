import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { attendanceNotClockedInJob } from '@pospay/contracts';
import type { ClaimedEvent, DeliveryOutcome } from '@pospay/db';
import type { DetectNotClockedIns } from '../use-cases/detect-not-clocked-in/detect-not-clocked-in.ts';

export const ATTENDANCE_NOT_CLOCKED_IN_QUEUE = 'attendance-not-clocked-in';
export const NOT_CLOCKED_IN_EVERY_MS = 5 * 60 * 1000;

type Deliver = (event: ClaimedEvent) => Promise<DeliveryOutcome>;

export function startNotClockedInProcessor(
  useCase: DetectNotClockedIns,
  redisUrl: string,
  prefix = 'bull',
) {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null, enableOfflineQueue: false });
  connection.on('error', () => undefined);
  const producer = connection.duplicate({ maxRetriesPerRequest: 1, commandTimeout: 5000 });
  producer.on('error', () => undefined);
  const queue = new Queue(ATTENDANCE_NOT_CLOCKED_IN_QUEUE, { connection: producer, prefix });
  queue.on('error', () => undefined);
  const worker = new Worker(
    ATTENDANCE_NOT_CLOCKED_IN_QUEUE,
    async (job) => {
      const data = attendanceNotClockedInJob.safeParse(job.data);
      if (!data.success) throw new Error('ATTENDANCE_NOT_CLOCKED_IN_JOB_INVALID');
      await useCase.execute(data.data.companyId);
    },
    { connection, concurrency: 1, prefix },
  );
  worker.on('error', () => undefined);
  return {
    // اكتشاف الشركة من CompanyCreated خارج أي معاملة؛ فشل Redis يعيد التوصيل ولا يستدعي التالي.
    deliver: async (event: ClaimedEvent, next: Deliver): Promise<DeliveryOutcome> => {
      if (event.eventType !== 'CompanyCreated') return next(event);
      const registered = await registerSchedule(queue, event);
      return registered.delivered ? next(event) : registered;
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

async function registerSchedule(queue: Queue, event: ClaimedEvent): Promise<DeliveryOutcome> {
  try {
    const data = attendanceNotClockedInJob.parse({ companyId: event.companyId });
    await queue.upsertJobScheduler(
      `${ATTENDANCE_NOT_CLOCKED_IN_QUEUE}-${data.companyId}`,
      { every: NOT_CLOCKED_IN_EVERY_MS },
      {
        name: 'detect',
        data,
        opts: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: true,
          removeOnFail: 100,
        },
      },
    );
    return { delivered: true };
  } catch {
    return { delivered: false, error: 'ATTENDANCE_NOT_CLOCKED_IN_SCHEDULE_RETRY', retryInMs: 2000 };
  }
}
