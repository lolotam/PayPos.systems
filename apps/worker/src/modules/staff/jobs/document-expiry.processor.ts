import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { documentExpiryJob } from '@pospay/contracts';
import type { ClaimedEvent, DeliveryOutcome } from '@pospay/db';
import type { DetectDocumentExpiries } from '../use-cases/detect-document-expiries/detect-document-expiries.ts';

export const DOCUMENT_EXPIRY_QUEUE = 'document-expiry';
// TODO(spec) MO-Q2: إيقاع الوظيفة غير محسوم؛ كل ست ساعات (موصى به).
export const DOCUMENT_EXPIRY_EVERY_MS = 6 * 60 * 60 * 1000;

type Deliver = (event: ClaimedEvent) => Promise<DeliveryOutcome>;

export function startDocumentExpiryProcessor(
  useCase: DetectDocumentExpiries,
  redisUrl: string,
  prefix = 'bull',
) {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null, enableOfflineQueue: false });
  connection.on('error', () => undefined);
  const producer = connection.duplicate({ maxRetriesPerRequest: 1, commandTimeout: 5000 });
  producer.on('error', () => undefined);
  const queue = new Queue(DOCUMENT_EXPIRY_QUEUE, { connection: producer, prefix });
  queue.on('error', () => undefined);
  const worker = new Worker(
    DOCUMENT_EXPIRY_QUEUE,
    async (job) => {
      const data = documentExpiryJob.safeParse(job.data);
      if (!data.success) throw new Error('DOCUMENT_EXPIRY_JOB_INVALID');
      await useCase.execute(data.data.companyId);
    },
    { connection, concurrency: 1, prefix },
  );
  worker.on('error', () => undefined);
  return {
    // اكتشاف الشركة من حدث outbox (نمط ADR-0032): لا قراءة عابرة للشركات، والجدول يسجل خارج أي معاملة.
    deliver: async (event: ClaimedEvent, next: Deliver): Promise<DeliveryOutcome> => {
      if (event.eventType !== 'EmployeeDocumentRecorded') return next(event);
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
    const data = documentExpiryJob.parse({ companyId: event.companyId });
    await queue.upsertJobScheduler(
      `${DOCUMENT_EXPIRY_QUEUE}-${data.companyId}`,
      { every: DOCUMENT_EXPIRY_EVERY_MS },
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
    return { delivered: false, error: 'DOCUMENT_EXPIRY_SCHEDULE_RETRY', retryInMs: 2000 };
  }
}
