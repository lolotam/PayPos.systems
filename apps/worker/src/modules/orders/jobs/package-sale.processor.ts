import { Queue, Worker, DelayedError, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { z } from 'zod';
import type { ClaimedEvent, DeliveryOutcome } from '@pospay/db';
import {
  PackageSaleRetryError,
  type ExecutePackageSale,
} from '../use-cases/execute-package-sale/execute-package-sale.ts';

export const PACKAGE_SALE_QUEUE = 'package-sale';
const FINALIZING_FAILURE = 'finalizing-sale-failure';
const saleJob = z.strictObject({ companyId: z.uuid(), saleRequestId: z.uuid() });
const saleRequested = z.strictObject({ sale_request_id: z.uuid() });
const failureProgress = z.strictObject({
  stage: z.literal(FINALIZING_FAILURE),
  code: z.string(),
  details: z.json().optional(),
});
type Failure = z.infer<typeof failureProgress>;

// تثبيت الفشل مرحلة مستقلة في progress؛ إعادة المحاولة لا تعيد البيع بعد قرار نهائي.
function saleHandler(useCase: ExecutePackageSale) {
  return async (job: Job, token?: string) => {
    const parsed = saleJob.safeParse(job.data);
    if (!parsed.success) throw new Error('PACKAGE_SALE_JOB_INVALID');
    const { companyId, saleRequestId } = parsed.data;
    const progress = failureProgress.safeParse(job.progress);
    if (progress.success) {
      return persistFailure(useCase, job, token, { companyId, saleRequestId, ...progress.data });
    }
    try {
      await useCase.execute(companyId, saleRequestId);
    } catch (error) {
      const retry = error instanceof PackageSaleRetryError ? error : undefined;
      const code = retry?.failureCode;
      if (code === undefined && job.attemptsMade + 1 < (job.opts.attempts ?? 1)) throw error;
      const failure = failureProgress.parse({
        stage: FINALIZING_FAILURE,
        code: code ?? 'PACKAGE_SALE_FAILED',
        ...(retry?.failureDetails === undefined ? {} : { details: retry.failureDetails }),
      });
      await job.updateProgress(failure);
      return persistFailure(useCase, job, token, { companyId, saleRequestId, ...failure });
    }
  };
}

async function persistFailure(
  useCase: ExecutePackageSale,
  job: Job,
  token: string | undefined,
  failure: Failure & { companyId: string; saleRequestId: string },
) {
  try {
    await useCase.fail(
      failure.companyId,
      failure.saleRequestId,
      failure.code,
      failure.details,
    );
  } catch {
    // الطلب المقبول يفضل قابلاً للإعادة حتى تعود قاعدة البيانات دون استهلاك محاولة جديدة.
    await job.moveToDelayed(Date.now() + 2000, token);
    throw new DelayedError();
  }
}

// ADR-0018: النشر إلى Redis خارج معاملة outbox؛ jobId ثابت يزيل أثر إعادة التسليم.
export function startPackageSaleProcessor(
  useCase: ExecutePackageSale,
  redisUrl: string,
  prefix = 'bull',
) {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null, enableOfflineQueue: false });
  connection.on('error', () => undefined);
  const producer = connection.duplicate({ maxRetriesPerRequest: 1, commandTimeout: 5000 });
  producer.on('error', () => undefined);
  const queue = new Queue(PACKAGE_SALE_QUEUE, { connection: producer, prefix });
  queue.on('error', () => undefined);
  const worker = new Worker(PACKAGE_SALE_QUEUE, saleHandler(useCase), {
    connection,
    concurrency: 1,
    prefix,
  });
  worker.on('error', () => undefined);
  return {
    deliver: (event: ClaimedEvent) => deliverSale(queue, event),
    ready: () => worker.waitUntilReady().then(() => undefined),
    close: async () => {
      await worker.close();
      await queue.close();
      producer.disconnect();
      connection.disconnect();
    },
  };
}

async function deliverSale(queue: Queue, event: ClaimedEvent): Promise<DeliveryOutcome> {
  const data = saleJob.safeParse({ companyId: event.companyId, saleRequestId: event.aggregateId });
  const payload = saleRequested.safeParse(event.payload);
  if (
    event.aggregateType !== 'package_sale_request' ||
    !data.success ||
    !payload.success ||
    payload.data.sale_request_id.toLowerCase() !== data.data.saleRequestId.toLowerCase()
  ) {
    return { delivered: false, error: 'PACKAGE_SALE_EVENT_INVALID', retryInMs: null };
  }
  try {
    await queue.add('sale', data.data, {
      jobId: event.id,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
      removeOnFail: 100,
    });
    return { delivered: true };
  } catch {
    return { delivered: false, error: 'PACKAGE_SALE_QUEUE_RETRY', retryInMs: 2000 };
  }
}
