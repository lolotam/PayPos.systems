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
const GENERIC_FAILURE: Failure = {
  stage: FINALIZING_FAILURE,
  code: 'SERVICE_CATEGORY_CLOSING_FAILED',
};

function closingHandler(useCase: RunServiceCategoryClosing) {
  return async (job: Job, token?: string) => {
    const parsed = serviceCategoryClosingJob.safeParse(job.data);
    if (!parsed.success) throw new Error('SERVICE_CATEGORY_CLOSING_JOB_INVALID');
    const { companyId, closingId } = parsed.data;
    const progress = failureProgress.safeParse(job.progress);
    if (progress.success)
      return persistFailure(useCase, job, token, { companyId, closingId, ...progress.data });
    if (reactivatedAfterDelay(job))
      return persistFailure(useCase, job, token, { companyId, closingId, ...GENERIC_FAILURE });
    try {
      await useCase.execute(companyId, closingId);
    } catch (error) {
      if (job.attemptsMade + 1 < (job.opts.attempts ?? 1)) throw error;
      await markFailureProgress(job, GENERIC_FAILURE);
      return persistFailure(useCase, job, token, { companyId, closingId, ...GENERIC_FAILURE });
    }
  };
}

/**
 * بيكشف إن المهمة اتفتحت تاني بعد تأخير أنا عملته: BullMQ بيزوّد attemptsStarted مع كل تفعيل
 * و attemptsMade بس مع كل محاولة فاشلة، فالفرق بعد طرح مرات الـ stall هو عدد تأخيراتنا.
 */
function reactivatedAfterDelay(job: Job): boolean {
  return job.attemptsStarted - job.attemptsMade - 1 - job.stalledCounter > 0;
}

/**
 * يكتب مؤشر الفشل في الطابور كخطوة اختيارية: رفض الكتابة ما يمنعش حفظ الفشل على صف الطلب.
 * المؤشر مش للعرض بس؛ هو اللي بيمنع إعادة تشغيل العمل بعد خلاص المحاولات، وعدّادات
 * المحاولات بتغطي الحالة اللي المؤشر ما انكتبش فيها.
 */
async function markFailureProgress(job: Job, failure: Failure): Promise<void> {
  try {
    await job.updateProgress(failure);
  } catch {
    // المؤشر بيمنع إعادة تشغيل العمل؛ رفضه ما يمنعش كتابة الفشل في القاعدة.
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
 * BullMQ بيفشل المهمة من غير ما المعالج يتنده لما تتجاوز حد التوقف، فصف الطلب بيفضل معلّق.
 * finishedOn بيتكتب بس لما المهمة تتقفل نهائيًا؛ أي فشل لسه فيه محاولات باقية بيتأجل ومش إنهاء.
 */
function isTerminalFailure(job: Job): boolean {
  return typeof job.finishedOn === 'number';
}

/**
 * يكتب رمز الفشل على صف الطلب اللي BullMQ قفله من غير ما المعالج يشتغل.
 * `fail` بيكتب بس على صف لسه pending، فالصف اللي المعالج خلّصه ما بيتغيرش.
 */
async function persistTerminalFailure(useCase: RunServiceCategoryClosing, job: Job): Promise<void> {
  const parsed = serviceCategoryClosingJob.safeParse(job.data);
  if (!parsed.success) return;
  try {
    await useCase.fail(
      parsed.data.companyId,
      parsed.data.closingId,
      'SERVICE_CATEGORY_CLOSING_FAILED',
    );
  } catch {
    // الموعد النهائي بيخلي الصف المعلّق ما يفضلش قفل التصنيف، فرفض الكتابة هنا مش بيوقف العامل.
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
  worker.on('failed', (job) => {
    if (job == null || !isTerminalFailure(job)) return;
    void persistTerminalFailure(useCase, job).catch(() => undefined);
  });
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
