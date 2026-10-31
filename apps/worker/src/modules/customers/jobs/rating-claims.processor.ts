import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { ratingClaimsJob } from '@pospay/contracts';
import type { ClaimedEvent, DeliveryOutcome } from '@pospay/db';

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
  execute(companyId: string): Promise<void>;
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
      await detector.execute(data.data.companyId);
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
    const data = ratingClaimsJob.parse({ companyId: event.companyId });
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
    return { delivered: true };
  } catch {
    return { delivered: false, error: 'RATING_CLAIMS_SCHEDULE_RETRY', retryInMs: 2000 };
  }
}
