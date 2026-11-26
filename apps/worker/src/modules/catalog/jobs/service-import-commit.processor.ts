import { Queue, Worker, DelayedError, UnrecoverableError, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { serviceImportCommitJob, serviceImportCommitRequested } from '@pospay/contracts';
import type { ClaimedEvent, DeliveryOutcome } from '@pospay/db';
import type { CommitServiceImport } from '../use-cases/commit-service-import/commit-service-import.ts';

export const SERVICE_IMPORT_QUEUE = 'service-import-commit';

// FR-009: محاولة أولى وثلاث إعادات للفشل غير المتوقع، ثم فشل تثبيت مُسمّى شرطي على الطلب الحي فقط.
const SERVICE_IMPORT_ATTEMPTS = 4;

/**
 * يكشف أن المهمة فُعِّلت من جديد بعد تأخير أجّلناه نحن: BullMQ يزيد attemptsStarted مع كل تفعيل
 * وattemptsMade مع كل محاولة فاشلة فقط، فالفرق بعد طرح مرات التوقف هو عدد تأخيراتنا.
 * DelayedError لا يزيد attemptsMade، فلا يكفي budgetExhausted وحده ولا مؤشر التقدم (قد يُرفض كتابته).
 */
function reactivatedAfterDelay(job: Job): boolean {
  return job.attemptsStarted - job.attemptsMade - 1 - job.stalledCounter > 0;
}

/**
 * كتابة رمز الفشل على الطلب الحي، مؤجَّلة قابلة لإعادة المحاولة إن رفضت القاعدة (نمط قفل التصنيفات).
 * بعد نجاحها تُرمى UnrecoverableError ليدخل الصف مجموعة الفاشل في BullMQ (مقاييس الفشل وremoveOnFail)
 * بدل أن يُسجَّل «مكتملاً» ويُحذف؛ ومستمع failed يتجاهلها فلا تُكتب النتيجة مرتين.
 */
async function persistFailure(
  useCase: CommitServiceImport,
  job: Job,
  token: string | undefined,
  companyId: string,
  previewId: string,
): Promise<never> {
  try {
    await useCase.fail(companyId, previewId);
  } catch {
    // كتابة الفشل نفسها رفضت: المهمة تتأجل لحظةً بدل أن يبقى الطلب عالقاً في commit_requested.
    await job.moveToDelayed(Date.now() + 2000, token);
    throw new DelayedError();
  }
  throw new UnrecoverableError('SERVICE_IMPORT_COMMIT_FAILED');
}

/** معالج صف الالتزام: إعادة التحقق كلها، وإنهاء الفشل غير المتوقع بعد آخر محاولة بلا إعادة تشغيل. */
function commitHandler(useCase: CommitServiceImport) {
  return async (job: Job, token?: string): Promise<void> => {
    const parsed = serviceImportCommitJob.safeParse(job.data);
    if (!parsed.success) throw new Error('SERVICE_IMPORT_JOB_INVALID');
    const { companyId, previewId } = parsed.data;
    // استنفاد الميزانية يعني أن كل محاولات التشغيل الحقيقية فشلت: أي تفعيل بعدها — تأخيرنا
    // أو stall أثناء الإنهاء مع ضياع المؤشر — ينهي الطلب فقط ولا يُعيد تشغيل الاستيراد
    // محاولة خامسة خارج الميزانية الموثّقة (FR-009، مراجعة 1186).
    const budgetExhausted = job.attemptsMade >= (job.opts.attempts ?? 1);
    // محاولة بعد التأخير الذي أجّلناه لكتابة الفشل: نُكمل الإنهاء بلا إعادة تشغيل الاستيراد.
    const finalizing =
      job.progress !== null && typeof job.progress === 'object' && 'stage' in job.progress;
    if (finalizing || budgetExhausted || reactivatedAfterDelay(job))
      return persistFailure(useCase, job, token, companyId, previewId);
    try {
      await useCase.execute(companyId, previewId);
    } catch (error) {
      // آخر محاولة للفشل غير المتوقع تُنهي الطلب الحي برمز التثبيت الفاشل بعد تراجع المعاملة (FR-009).
      if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
        await job.updateProgress({ stage: 'finalizing-service-import-commit-failure' }).catch(() => undefined);
        return persistFailure(useCase, job, token, companyId, previewId);
      }
      throw error;
    }
  };
}

/** يسلّم حدث الالتزام للطابور بعد فحص الحمولة الصارم ومطابقة صف الطلب في outbox نفسه. */
async function deliverCommit(
  queue: Queue,
  event: ClaimedEvent,
): Promise<DeliveryOutcome> {
  try {
    // عقد الحمولة الصارم يُفحص قبل بناء الوظيفة: حقول زائدة أو preview_id ناقص رفض مسمّى
    // غير قابل لإعادة السحب، لأن إعادة السحب لن تصلح حدثًا شكله غلط (P2 مراجعة 32b-2)،
    // وpreview_id في الحمولة يجب أن يطابق صف الطلب في outbox نفسه (نمط قفل التصنيفات).
    const payload = serviceImportCommitRequested.safeParse(event.payload);
    const data = serviceImportCommitJob.safeParse({
      companyId: event.companyId,
      previewId: payload.success ? payload.data.preview_id : event.aggregateId,
    });
    if (
      !payload.success ||
      !data.success ||
      payload.data.preview_id.toLowerCase() !== event.aggregateId.toLowerCase()
    )
      return { delivered: false, error: 'SERVICE_IMPORT_COMMIT_EVENT_INVALID', retryInMs: null };
    await queue.add('commit', data.data, {
      jobId: event.id,
      attempts: SERVICE_IMPORT_ATTEMPTS,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
      removeOnFail: 100,
    });
    return { delivered: true };
  } catch {
    return { delivered: false, error: 'SERVICE_IMPORT_QUEUE_RETRY', retryInMs: 2000 };
  }
}

// ADR-0018: النشر إلى Redis خارج معاملة outbox؛ jobId ثابت يزيل أثر إعادة التسليم.
export function startServiceImportProcessor(
  useCase: CommitServiceImport,
  redisUrl: string,
  prefix = 'bull',
) {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null, enableOfflineQueue: false });
  connection.on('error', () => undefined);
  const producer = connection.duplicate({ maxRetriesPerRequest: 1, commandTimeout: 5000 });
  producer.on('error', () => undefined);
  const queue = new Queue(SERVICE_IMPORT_QUEUE, { connection: producer, prefix });
  queue.on('error', () => undefined);
  const worker = new Worker(SERVICE_IMPORT_QUEUE, commitHandler(useCase), {
    connection,
    concurrency: 1,
    prefix,
  });
  worker.on('error', () => undefined);
  worker.on('failed', (job, error) => {
    // BullMQ أقفل الصف بلا معالج (تجاوز حد التوقف): إنهاء طلب حي بكتابة شرطية أخيرة.
    // UnrecoverableError صدرت من persistFailure بعد نجاح كتابة الفشل، فلا كتابة ثانية.
    if (job === undefined || job === null || error instanceof UnrecoverableError) return;
    const parsed = serviceImportCommitJob.safeParse(job.data);
    if (!parsed.success || typeof job.finishedOn !== 'number') return;
    void useCase.fail(parsed.data.companyId, parsed.data.previewId).catch(() => undefined);
  });
  return {
    deliver: (event: ClaimedEvent) => deliverCommit(queue, event),
    ready: () => worker.waitUntilReady().then(() => undefined),
    close: async () => {
      await worker.close();
      await queue.close();
      producer.disconnect();
      connection.disconnect();
    },
  };
}
