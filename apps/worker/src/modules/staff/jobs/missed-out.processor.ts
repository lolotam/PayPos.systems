import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { attendanceMissedOutJob } from '@pospay/contracts';
import type { ClaimedEvent, DeliveryOutcome } from '@pospay/db';
import type { DetectMissedOuts } from '../use-cases/detect-missed-outs/detect-missed-outs.ts';

export const ATTENDANCE_MISSED_OUT_QUEUE = 'attendance-missed-out';
// TODO(spec) MO-Q1: إيقاع الوظيفة غير محسوم؛ كل خمس دقائق (موصى به).
export const MISSED_OUT_EVERY_MS = 5 * 60 * 1000;

type Deliver = (event: ClaimedEvent) => Promise<DeliveryOutcome>;

export function startMissedOutProcessor(
  useCase: DetectMissedOuts,
  redisUrl: string,
  prefix = 'bull',
) {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null, enableOfflineQueue: false });
  connection.on('error', () => undefined);
  const producer = connection.duplicate({ maxRetriesPerRequest: 1, commandTimeout: 5000 });
  producer.on('error', () => undefined);
  const queue = new Queue(ATTENDANCE_MISSED_OUT_QUEUE, { connection: producer, prefix });
  queue.on('error', () => undefined);
  const worker = new Worker(
    ATTENDANCE_MISSED_OUT_QUEUE,
    async (job) => {
      const data = attendanceMissedOutJob.safeParse(job.data);
      if (!data.success) throw new Error('ATTENDANCE_MISSED_OUT_JOB_INVALID');
      await useCase.execute(data.data.companyId);
    },
    { connection, concurrency: 1, prefix },
  );
  worker.on('error', () => undefined);
  return {
    // اكتشاف الشركة من حدث outbox (نمط ADR-0022): لا قراءة عابرة للشركات، والجدول يسجل خارج أي معاملة.
    deliver: async (event: ClaimedEvent, next: Deliver): Promise<DeliveryOutcome> => {
      if (event.eventType !== 'AttendanceClockedIn') return next(event);
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
    const data = attendanceMissedOutJob.parse({ companyId: event.companyId });
    await queue.upsertJobScheduler(
      `${ATTENDANCE_MISSED_OUT_QUEUE}-${data.companyId}`,
      { every: MISSED_OUT_EVERY_MS },
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
    return { delivered: false, error: 'ATTENDANCE_MISSED_OUT_SCHEDULE_RETRY', retryInMs: 2000 };
  }
}
