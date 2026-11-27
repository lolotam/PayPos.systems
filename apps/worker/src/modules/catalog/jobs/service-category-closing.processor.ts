import { Queue, Worker, DelayedError, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { z } from 'zod';
import {
  SERVICE_CATEGORY_CLOSING_FAILURE_CODES,
  serviceCategoryClosingJob,
  serviceCategoryClosingRequested,
} from '@pospay/contracts';
import type { ClaimedEvent, DeliveryOutcome } from '@pospay/db';
import { FailurePersistedError, reactivatedAfterDelay } from './catalog-job-finalization.ts';
import type { RunServiceCategoryClosing } from '../use-cases/run-service-category-closing/run-service-category-closing.ts';

export const SERVICE_CATEGORY_CLOSING_QUEUE = 'service-category-closing';
export const SERVICE_CATEGORY_CLOSING_FINALIZATION_QUEUE = 'service-category-closing-finalization';
const FINALIZING_FAILURE = 'finalizing-service-category-closing-failure';
const FINALIZING_FAILURE_JOB = 'finalizing-failure';
const failureProgress = z.strictObject({
  stage: z.literal(FINALIZING_FAILURE),
  code: z.enum(SERVICE_CATEGORY_CLOSING_FAILURE_CODES),
});
type Failure = z.infer<typeof failureProgress>;
const GENERIC_FAILURE: Failure = {
  stage: FINALIZING_FAILURE,
  code: 'SERVICE_CATEGORY_CLOSING_FAILED',
};

/** مراقب سقوط إعادة كتابة الفشل عند رفض القاعدة والطابور معاً — للتسجيل بلا بيانات خاصة. */
export type ClosingFinalizationDropObserver = (input: {
  readonly companyId: string;
  readonly closingId: string;
  readonly code: 'SERVICE_CATEGORY_CLOSING_FAILURE_RETRY_DROPPED';
}) => void;

/** معرّف مهمة إعادة كتابة الفشل بلا نقطتين (:) حتى لا يرفضه فاحص BullMQ. */
export function terminalFailureJobId(closingId: string, rawJobId: string | undefined): string {
  const suffix = rawJobId ?? 'job';
  return `terminal-fail-${closingId}-${suffix}`.replaceAll(':', '-');
}

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

/** معالج طابور إعادة كتابة الفشل: يكتب رمز الفشل فقط وبميزانية محاولات BullMQ المحددة. */
function finalizationHandler(useCase: RunServiceCategoryClosing) {
  return async (job: Job) => {
    const parsed = serviceCategoryClosingJob.safeParse(job.data);
    if (!parsed.success) throw new Error('SERVICE_CATEGORY_CLOSING_JOB_INVALID');
    try {
      await useCase.fail(
        parsed.data.companyId,
        parsed.data.closingId,
        'SERVICE_CATEGORY_CLOSING_FAILED',
      );
    } catch {
      throw new Error('SERVICE_CATEGORY_CLOSING_FINALIZATION_RETRY');
    }
  };
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

/**
 * يكتب رمز الفشل على صف الطلب؛ لو الكتابة نفسها فشلت، المهمة بتتأجل بدل ما تضيع.
 * بعد نجاح الكتابة بيرمي FailurePersistedError (من نوع UnrecoverableError) عشان الصف يدخل مجموعة الفاشل في BullMQ
 * (مقاييس الفشل وremoveOnFail) بدل ما يتسجل «مكتمل» ويتمسح؛ ومستمع failed بيتجاهله هو بالذات.
 */
async function persistFailure(
  useCase: RunServiceCategoryClosing,
  job: Job,
  token: string | undefined,
  failure: Failure & { companyId: string; closingId: string },
): Promise<never> {
  try {
    await useCase.fail(failure.companyId, failure.closingId, failure.code);
  } catch {
    await job.moveToDelayed(Date.now() + 2000, token);
    throw new DelayedError();
  }
  throw new FailurePersistedError(failure.code);
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
 * لو رفضت القاعدة الكتابة، بتتحوّل لمهمة إعادة كتابة متأخرة: الخطأ العابر في
 * القاعدة كان بيضيع علامة الفشل وبيسيب صف الطلب معلّق للأبد.
 */
async function persistTerminalFailure(
  useCase: RunServiceCategoryClosing,
  job: Job,
  finalizationQueue: Queue,
  onDrop?: ClosingFinalizationDropObserver,
): Promise<void> {
  const parsed = serviceCategoryClosingJob.safeParse(job.data);
  if (!parsed.success) return;
  const { companyId, closingId } = parsed.data;
  try {
    await useCase.fail(companyId, closingId, 'SERVICE_CATEGORY_CLOSING_FAILED');
  } catch {
    try {
      await finalizationQueue.add(FINALIZING_FAILURE_JOB, parsed.data, {
        jobId: terminalFailureJobId(closingId, job.id),
        delay: 2000,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
        removeOnFail: 100,
      });
    } catch {
      try {
        await useCase.fail(companyId, closingId, 'SERVICE_CATEGORY_CLOSING_FAILED');
      } catch {
        // الموعد النهائي بيخلي الصف المعلّق ما يفضلش قفل التصنيف؛ نبلّغ عن سقوط إعادة المحاولة بلا بيانات خاصة.
        onDrop?.({
          companyId,
          closingId,
          code: 'SERVICE_CATEGORY_CLOSING_FAILURE_RETRY_DROPPED',
        });
      }
    }
  }
}

/** يغلق العاملين والطابورين ويستنزف الكتابات الجارية ويفصل الاتصالات مهما رفض الإغلاق الأول. */
async function closeClosingProcessor(parts: {
  worker: Worker;
  finalizationWorker: Worker;
  queue: Queue;
  finalizationQueue: Queue;
  inFlightFailures: Set<Promise<void>>;
  disconnect: () => void;
}): Promise<void> {
  const workersSettled = await Promise.allSettled([
    parts.worker.close(),
    parts.finalizationWorker.close(),
  ]);
  await Promise.allSettled([...parts.inFlightFailures]);
  const queuesSettled = await Promise.allSettled([
    parts.queue.close(),
    parts.finalizationQueue.close(),
  ]);
  parts.disconnect();
  const rejected = [...workersSettled, ...queuesSettled].find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (rejected !== undefined) throw rejected.reason;
}

/**
 * يشغّل طابور قفل وفتح التصنيفات الكبيرة: يسلّم الحدث للطابور، ويشغّل الصف تحته،
 * مع طابور وعامل منفصلين لإعادة كتابة الفشل حتى لا تستهلكه عمالة قديمة أثناء التحديث التدريجي.
 *
 * @param useCase               حالة الاستخدام اللي تشغيل الطلب وكتابة نتيجته
 * @param redisUrl              عنوان Redis اللي فيه الطابور
 * @param prefix                بادئة طوابير BullMQ
 * @param onFinalizationDropped مراقب اختياري عند رفض القاعدة وطابور إعادة المحاولة معاً
 * @returns التسليم والجاهزية والإغلاق
 */
export function startServiceCategoryClosingProcessor(
  useCase: RunServiceCategoryClosing,
  redisUrl: string,
  prefix = 'bull',
  onFinalizationDropped?: ClosingFinalizationDropObserver,
) {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null, enableOfflineQueue: false });
  connection.on('error', () => undefined);
  const finalizationConnection = connection.duplicate({ maxRetriesPerRequest: null, enableOfflineQueue: false });
  finalizationConnection.on('error', () => undefined);
  const producer = connection.duplicate({ maxRetriesPerRequest: 1, commandTimeout: 5000 });
  producer.on('error', () => undefined);
  const queue = new Queue(SERVICE_CATEGORY_CLOSING_QUEUE, { connection: producer, prefix });
  queue.on('error', () => undefined);
  const worker = new Worker(SERVICE_CATEGORY_CLOSING_QUEUE, closingHandler(useCase), { connection, concurrency: 1, prefix });
  worker.on('error', () => undefined);
  const finalizationQueue = new Queue(SERVICE_CATEGORY_CLOSING_FINALIZATION_QUEUE, { connection: producer, prefix });
  finalizationQueue.on('error', () => undefined);
  const finalizationWorker = new Worker(SERVICE_CATEGORY_CLOSING_FINALIZATION_QUEUE, finalizationHandler(useCase), {
    connection: finalizationConnection,
    concurrency: 1,
    prefix,
  });
  finalizationWorker.on('error', () => undefined);
  // كتابة الفشل بعد إغلاق المهمة مش جزء من عمل BullMQ، فالعامل بيتقفل قبلها.
  // المجموعة دي هي اللي بتخلي الإغلاق ينتظرها، عشان صف الطلب ما يفضلش معلّق.
  const inFlightFailures = new Set<Promise<void>>();
  worker.on('failed', (job, error) => {
    if (job == null || error instanceof FailurePersistedError || !isTerminalFailure(job)) return;
    const pending = persistTerminalFailure(useCase, job, finalizationQueue, onFinalizationDropped).finally(() =>
      inFlightFailures.delete(pending),
    );
    inFlightFailures.add(pending);
  });
  return {
    deliver: (event: ClaimedEvent) => deliverClosing(queue, useCase, event),
    ready: async () => {
      await Promise.all([worker.waitUntilReady(), finalizationWorker.waitUntilReady()]);
    },
    close: () =>
      closeClosingProcessor({
        worker,
        finalizationWorker,
        queue,
        finalizationQueue,
        inFlightFailures,
        disconnect: () => {
          producer.disconnect();
          finalizationConnection.disconnect();
          connection.disconnect();
        },
      }),
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
