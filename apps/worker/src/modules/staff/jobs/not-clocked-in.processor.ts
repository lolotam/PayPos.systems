import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { attendanceNotClockedInJob } from '@pospay/contracts';
import type { ClaimedEvent, DeliveryOutcome } from '@pospay/db';

export const ATTENDANCE_NOT_CLOCKED_IN_QUEUE = 'attendance-not-clocked-in';
export const NOT_CLOCKED_IN_EVERY_MS = 5 * 60 * 1000;

type Deliver = (event: ClaimedEvent) => Promise<DeliveryOutcome>;

/** كاشف يعمل على نفس جدولة الشركة: عدم الحضور ثم عدم الرجوع من البريك (BW-Q5). */
export interface CompanyAttendanceDetector {
  execute(companyId: string): Promise<unknown>;
}

export function startNotClockedInProcessor(
  detectors: readonly CompanyAttendanceDetector[],
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
      // الكواشف بالترتيب، وكل واحد يكمل حتى لو فشل اللي قبله؛ أي فشل يعيد المهمة والدفتر يمنع التكرار.
      const failures: unknown[] = [];
      for (const detector of detectors)
        await detector.execute(data.data.companyId).catch((error: unknown) => {
          failures.push(error);
        });
      if (failures.length > 0) throw failures[0];
    },
    { connection, concurrency: 1, prefix },
  );
  worker.on('error', () => undefined);
  return {
    // CompanyCreated يبدأ اليوم الأول وAttendanceClockedIn يصلح فقد الجدولة؛ Redis خارج المعاملة.
    deliver: async (event: ClaimedEvent, next: Deliver): Promise<DeliveryOutcome> => {
      if (event.eventType !== 'CompanyCreated' && event.eventType !== 'AttendanceClockedIn')
        return next(event);
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
