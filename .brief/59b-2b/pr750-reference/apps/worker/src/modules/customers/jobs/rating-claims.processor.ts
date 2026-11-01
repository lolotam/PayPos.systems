import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { ratingClaimsJob, type RatingClaimsJob } from '@pospay/contracts';
import type { ClaimedEvent, DeliveryOutcome } from '@pospay/db';
import {
  RatingClaimsFailedError,
  type DueRatingCursor,
} from '../use-cases/claim-rating-requests/claim-rating-requests.ts';

export const RATING_CLAIMS_QUEUE = 'rating-claims';
export const RATING_CLAIMS_EVERY_MS = 60 * 1000;

/** الأحداث اللي بتعمل أو بتصلّح جدولة مطالبة الشركة. */
export const RATING_CLAIMS_TRIGGERS = [
  'ServiceSessionRecorded',
  'ServiceSessionLinesAdded',
  'ServiceLineChanged',
  'RatingClaimsDiscoveryRequested',
] as const;

type Deliver = (event: ClaimedEvent) => Promise<DeliveryOutcome>;

/** كاشف المطالبة بطلبات التقييم المستحقة في شركة واحدة. */
export interface RatingClaimDetector {
  execute(companyId: string, after: DueRatingCursor | null): Promise<DueRatingCursor | null>;
}

/**
 * يشغّل جدولة المطالبة لكل شركة: أول حدث جدولة بينشئ الجدولة وكل حدث بعده يصلّحها.
 */
export function startRatingClaimsProcessor(
  detector: RatingClaimDetector,
  redisUrl: string,
  prefix = 'bull',
) {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null, enableOfflineQueue: false });
  connection.on('error', () => undefined);
  const producer = connection.duplicate({ maxRetriesPerRequest: 1, commandTimeout: 5000 });
  producer.on('error', () => undefined);
  const queue = new Queue(RATING_CLAIMS_QUEUE, { connection: producer, prefix });
  queue.on('error', () => undefined);
  const worker = new Worker(
    RATING_CLAIMS_QUEUE,
    async (job) => {
      const data = ratingClaimsJob.safeParse(job.data);
      if (!data.success) throw new Error('RATING_CLAIMS_JOB_INVALID');
      const after =
        data.data.after === undefined
          ? null
          : { dueAt: new Date(data.data.after.dueAt), id: data.data.after.id };
      try {
        const continuation = await detector.execute(data.data.companyId, after);
        const nextData = continuationData(data.data.companyId, continuation);
        // BullMQ ينشئ المهمة التالية والـ retry من job.data؛ تحديث template وحده يعيد الصفحة القديمة.
        await job.updateData(nextData);
        await writeSchedule(queue, nextData);
      } catch (error) {
        if (error instanceof RatingClaimsFailedError) {
          const nextData = continuationData(data.data.companyId, error.after);
          await job.updateData(nextData);
          await writeSchedule(queue, nextData);
        }
        throw error;
      }
    },
    { connection, concurrency: 1, prefix },
  );
  worker.on('error', () => undefined);
  return {
    // أول زيارة بجدولة بتعمل الجدولة، وكل زيارة بعده بتصلّحها؛ Redis خارج المعاملة.
    deliver: async (event: ClaimedEvent, next: Deliver): Promise<DeliveryOutcome> => {
      if (!(RATING_CLAIMS_TRIGGERS as readonly string[]).includes(event.eventType))
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
    const schedulerId = `${RATING_CLAIMS_QUEUE}-${event.companyId}`;
    const current = await queue.getJobScheduler(schedulerId);
    const existing = ratingClaimsJob.safeParse(current?.template?.data);
    if (existing.success && existing.data.companyId === event.companyId) {
      // الجدولة الموجودة قد تتقدم أثناء المهمة؛ trigger لا يعيد كتابة cursor قد يكون أقدم.
      return { delivered: true };
    }
    await writeSchedule(queue, { companyId: event.companyId });
    return { delivered: true };
  } catch {
    return { delivered: false, error: 'RATING_CLAIMS_SCHEDULE_RETRY', retryInMs: 2000 };
  }
}

function continuationData(companyId: string, after: DueRatingCursor | null): RatingClaimsJob {
  if (after === null) return { companyId };
  return { companyId, after: { dueAt: after.dueAt.toISOString(), id: after.id } };
}

async function writeSchedule(queue: Queue, data: RatingClaimsJob): Promise<void> {
  await queue.upsertJobScheduler(
    `${RATING_CLAIMS_QUEUE}-${data.companyId}`,
    { every: RATING_CLAIMS_EVERY_MS },
    {
      name: 'claim',
      data,
      opts: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
        removeOnFail: 100,
      },
    },
  );
}
