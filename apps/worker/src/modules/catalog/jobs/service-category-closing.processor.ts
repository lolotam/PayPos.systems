import { Queue, Worker, DelayedError, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { z } from 'zod';
import {
  SERVICE_CATEGORY_CLOSING_FAILURE_CODES,
  serviceCategoryClosingJob,
  serviceCategoryClosingRequested,
} from '@pospay/contracts';
import type { ClaimedEvent, DeliveryOutcome } from '@pospay/db';
import type { RunServiceCategoryClosing } from '../use-cases/run-service-category-closing/run-service-category-closing.ts';

export const SERVICE_CATEGORY_CLOSING_QUEUE = 'service-category-closing';
const FINALIZING_FAILURE = 'finalizing-service-category-closing-failure';
const failureProgress = z.strictObject({
  stage: z.literal(FINALIZING_FAILURE),
  code: z.enum(SERVICE_CATEGORY_CLOSING_FAILURE_CODES),
});
type Failure = z.infer<typeof failureProgress>;

function closingHandler(useCase: RunServiceCategoryClosing) {
  return async (job: Job, token?: string) => {
    const parsed = serviceCategoryClosingJob.safeParse(job.data);
    if (!parsed.success) throw new Error('SERVICE_CATEGORY_CLOSING_JOB_INVALID');
    const { companyId, closingId } = parsed.data;
    const progress = failureProgress.safeParse(job.progress);
    if (progress.success)
      return persistFailure(useCase, job, token, { companyId, closingId, ...progress.data });
    try {
      await useCase.execute(companyId, closingId);
    } catch (error) {
      if (job.attemptsMade + 1 < (job.opts.attempts ?? 1)) throw error;
      const failure = failureProgress.parse({
        stage: FINALIZING_FAILURE,
        code: 'SERVICE_CATEGORY_CLOSING_FAILED',
      });
      await markFailureProgress(job, failure);
      return persistFailure(useCase, job, token, { companyId, closingId, ...failure });
    }
  };
}

/**
 * يكتب مؤشر الفشل في الطابور كخطوة اختيارية: رفض الكتابة ما يمنعش حفظ الفشل على صف الطلب،
 * لأن المؤشر للعرض فقط، وصف الطلب في القاعدة هو المصدر.
 */
async function markFailureProgress(job: Job, failure: Failure): Promise<void> {
  try {
    await job.updateProgress(failure);
  } catch {
    // المؤشر ثانوي؛ رفضه ما يمنعش كتابة الفشل في القاعدة.
  }
}

/** يكتب رمز الفشل على صف الطلب؛ لو الكتابة نفسها فشلت، المهمة بتتأجل بدل ما تضيع. */
async function persistFailure(
  useCase: RunServiceCategoryClosing,
  job: Job,
  token: string | undefined,
  failure: Failure & { companyId: string; closingId: string },
) {
  try {
    await useCase.fail(failure.companyId, failure.closingId, failure.code);
  } catch {
    await job.moveToDelayed(Date.now() + 2000, token);
    throw new DelayedError();
  }
}

/**
 * يشغّل طابور قفل وفتح التصنيفات الكبيرة: يسلّم الحدث للطابور، ويشغّل الصف تحته.
 *
 * @param useCase  حالة الاستخدام اللي تشغيل الطلب وكتابة نتيجته
 * @param redisUrl عنوان Redis اللي فيه الطابور
 * @param prefix   بادئة طوابير BullMQ
 * @returns التسليم والجاهزية والإغلاق
 */
export function startServiceCategoryClosingProcessor(
  useCase: RunServiceCategoryClosing,
  redisUrl: string,
  prefix = 'bull',
) {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null, enableOfflineQueue: false });
  connection.on('error', () => undefined);
  const producer = connection.duplicate({ maxRetriesPerRequest: 1, commandTimeout: 5000 });
  producer.on('error', () => undefined);
  const queue = new Queue(SERVICE_CATEGORY_CLOSING_QUEUE, { connection: producer, prefix });
  queue.on('error', () => undefined);
  const worker = new Worker(SERVICE_CATEGORY_CLOSING_QUEUE, closingHandler(useCase), {
    connection,
    concurrency: 1,
    prefix,
  });
  worker.on('error', () => undefined);
  return {
    deliver: (event: ClaimedEvent) => deliverClosing(queue, useCase, event),
    ready: () => worker.waitUntilReady().then(() => undefined),
    close: async () => {
      await worker.close();
      await queue.close();
      producer.disconnect();
      connection.disconnect();
    },
  };
}

/**
 * يسلّم الحدث للطابور بعد التأكد من إن الحمولة بتطابق صف الطلب.
 * الحدث الغلط بيفشل الصف وبيترفض من غير إعادة محاولة، لأن إعادة السحب مش هتصلّحه.
 */
async function deliverClosing(
  queue: Queue,
  useCase: RunServiceCategoryClosing,
  event: ClaimedEvent,
): Promise<DeliveryOutcome> {
  const data = serviceCategoryClosingJob.safeParse({
    companyId: event.companyId,
    closingId: event.aggregateId,
  });
  const payload = serviceCategoryClosingRequested.safeParse(event.payload);
  if (
    !data.success ||
    !payload.success ||
    payload.data.closing_id.toLowerCase() !== data.data.closingId.toLowerCase()
  ) {
    if (data.success) {
      try {
        await useCase.fail(
          data.data.companyId,
          data.data.closingId,
          'SERVICE_CATEGORY_CLOSING_FAILED',
        );
      } catch {
        return {
          delivered: false,
          error: 'SERVICE_CATEGORY_CLOSING_FAILURE_PERSIST_RETRY',
          retryInMs: 2000,
        };
      }
    }
    return { delivered: false, error: 'SERVICE_CATEGORY_CLOSING_EVENT_INVALID', retryInMs: null };
  }
  try {
    await queue.add('run', data.data, {
      jobId: event.id,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
      removeOnFail: 100,
    });
    return { delivered: true };
  } catch {
    return { delivered: false, error: 'SERVICE_CATEGORY_CLOSING_QUEUE_RETRY', retryInMs: 2000 };
  }
}
