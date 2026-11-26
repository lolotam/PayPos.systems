import { DelayedError, type Job, type Queue } from 'bullmq';
import { z } from 'zod';
import { packageImportCommitJob, packageImportCommitRequested } from '@pospay/contracts';
import type { ClaimedEvent, DeliveryOutcome } from '@pospay/db';
import {
  PackageCommitRetryError,
  PACKAGE_COMMIT_FAILURE_CODES,
  type CommitPackageImport,
} from '../use-cases/commit-package-import/commit-package-import.ts';
import { createBullQueueWorker } from './bullmq-queue-worker.ts';

export const PACKAGE_IMPORT_COMMIT_QUEUE = 'package-import-commit';
// حد العالق جزء من عقد التشغيل لا إعداد حر: إعادة واحدة بعد العالق تكفي، وأمان المال من حارس الحالة لا من كثرة المحاولات.
const PACKAGE_IMPORT_COMMIT_MAX_STALLED = 1;
// القفل بيتجدد طول ما الهاندلر منتظر قاعدة البيانات؛ قفل أطول يعدي زحزة Redis قصيرة على اتصال بلا offline queue.
const PACKAGE_IMPORT_COMMIT_LOCK_MS = 60_000;
const FINALIZING_FAILURE = 'finalizing-commit-failure';
const commitFailureCode = z.enum(PACKAGE_COMMIT_FAILURE_CODES);
const failureProgress = z.strictObject({
  stage: z.literal(FINALIZING_FAILURE),
  code: commitFailureCode,
});
type Failure = z.infer<typeof failureProgress>;
// كل خطأ يعاد من الحد يخرج بالرسالة الثابتة بلا cause؛ النص الخام قد يحمل معاملات اتصال فلا يكتبه BullMQ في Redis.
const RETRY_MESSAGE = 'PACKAGE_IMPORT_COMMIT_RETRY';

/** ساعة نافذة العشر دقائق: القراءة لحظية عند كل قرار، وpastWindow يعيد الحساب ولا يحفظ نتيجة. */
interface StaleClock {
  now(): number;
  pastWindow(job: Job): boolean;
}

/** محاولة تشغيل واحدة: المهمة الحالية مع الاعتماديات التي تحتاجها قرارات الفشل، حتى لا تتناقلها الدوال مفرقة. */
interface JobRun {
  useCase: CommitPackageImport;
  job: Job;
  token: string | undefined;
  clock: StaleClock;
}

// المرحلة محفوظة في progress؛ إعادة تشغيل العامل تكمّل تثبيت الفشل من غير ما تشغّل المعاملة المالية تاني.
function commitHandler(useCase: CommitPackageImport, clock: StaleClock) {
  return async (job: Job, token?: string) => {
    const parsed = packageImportCommitJob.safeParse(job.data);
    if (!parsed.success) throw new Error('PACKAGE_IMPORT_COMMIT_JOB_INVALID');
    const { companyId, previewId } = parsed.data;
    const run: JobRun = { useCase, job, token, clock };
    const progress = failureProgress.safeParse(job.progress);
    if (progress.success)
      return persistFailure(run, { companyId, previewId, code: progress.data.code });
    // العمر يقاس من لحظة enqueue؛ بعد النافذة المسح هو صاحب القرار فلا تبدأ محاولة مالية جديدة.
    if (clock.pastWindow(job)) return;
    try {
      await useCase.execute(companyId, previewId);
    } catch (error) {
      return finalizeFailure(run, { companyId, previewId, error });
    }
  };
}

/** يقرر مصير الفشل: إعادة برسالة ثابتة، أو تخزين الرمز الآمن في progress ثم تثبيته في قاعدة البيانات. */
async function finalizeFailure(
  run: JobRun,
  failure: { companyId: string; previewId: string; error: unknown },
): Promise<void> {
  const { job, clock } = run;
  const code =
    failure.error instanceof PackageCommitRetryError ? failure.error.failureCode : undefined;
  // إعادة المحاولة على الخطأ المجهول تُهدر ميزانية كاملة خلف قفل المحاولة السابقة، فلا تُعاد بعد النافذة.
  if (
    code === undefined &&
    !clock.pastWindow(job) &&
    job.attemptsMade + 1 < (job.opts.attempts ?? 1)
  )
    throw new Error(RETRY_MESSAGE);
  const parsed = failureProgress.parse({
    stage: FINALIZING_FAILURE,
    code: code ?? 'IMPORT_COMMIT_FAILED',
  });
  // لو فشلت كتابة progress يعاد العمل برسالة ثابتة: الجولة التالية تعيد التقييم ولا يُنصف أثر نصف موثوق.
  await job.updateProgress(parsed).catch(() => {
    throw new Error(RETRY_MESSAGE);
  });
  return persistFailure(run, {
    companyId: failure.companyId,
    previewId: failure.previewId,
    code: parsed.code,
  });
}

async function persistFailure(
  run: JobRun,
  failure: { companyId: string; previewId: string; code: Failure['code'] },
): Promise<void> {
  const { useCase, job, token, clock } = run;
  try {
    await useCase.fail(failure.companyId, failure.previewId, failure.code);
  } catch {
    // DelayedError لا يستهلك محاولة جديدة؛ بعد النافذة المسح ينهي بالرمز العام بدل تأجيل بلا نهاية.
    if (clock.pastWindow(job)) return;
    try {
      await job.moveToDelayed(clock.now() + 2000, token);
    } catch {
      // DelayedError فقط بعد نجاح moveToDelayed؛ فشل التأجيل نفسه إعادة برسالة ثابتة.
      throw new Error(RETRY_MESSAGE);
    }
    throw new DelayedError();
  }
}

// ADR-0018: النشر إلى Redis خارج معاملة outbox؛ jobId ثابت يزيل أثر إعادة التسليم.
export function startPackageImportCommitProcessor(
  useCase: CommitPackageImport,
  redisUrl: string,
  options: {
    prefix?: string;
    retryDelayMs?: (attempt: number) => number | null;
    lockDurationMs?: number;
    stalledIntervalMs?: number;
    now?: () => number;
  } = {},
) {
  const retryDelay = options.retryDelayMs ?? (() => 2000);
  const prefix = options.prefix ?? 'bull';
  const now = options.now ?? Date.now;
  const clock: StaleClock = {
    now,
    // الحساب لحظي عند كل نقطة قرار؛ النتيجة المحفوظة تتقادم قبل انتهاء انتظار قاعدة البيانات.
    pastWindow: (job) => useCase.windowClosed(job.timestamp, now()),
  };
  const bull = createBullQueueWorker({
    name: PACKAGE_IMPORT_COMMIT_QUEUE,
    redisUrl,
    prefix,
    handler: commitHandler(useCase, clock),
    lockDurationMs: options.lockDurationMs ?? PACKAGE_IMPORT_COMMIT_LOCK_MS,
    maxStalledCount: PACKAGE_IMPORT_COMMIT_MAX_STALLED,
    ...(options.stalledIntervalMs === undefined
      ? {}
      : { stalledIntervalMs: options.stalledIntervalMs }),
  });
  return {
    deliver: (event: ClaimedEvent) => deliverCommit(bull.queue, event, retryDelay),
    ready: bull.ready,
    close: bull.close,
  };
}

async function deliverCommit(
  queue: Queue,
  event: ClaimedEvent,
  retryDelay: (attempt: number) => number | null,
): Promise<DeliveryOutcome> {
  const data = packageImportCommitJob.safeParse({
    companyId: event.companyId,
    previewId: event.aggregateId,
  });
  const payload = packageImportCommitRequested.safeParse(event.payload);
  // الحدث المشوّه لا يحدد طلبًا موثوقًا، فلا قاعدة بيانات هنا: المسح المسجّل قبله يفشل الطلب الحقيقي خلال عشر دقائق.
  if (
    event.aggregateType !== 'import_preview' ||
    !data.success ||
    !payload.success ||
    payload.data.preview_id.toLowerCase() !== data.data.previewId.toLowerCase()
  ) {
    return { delivered: false, error: 'PACKAGE_IMPORT_COMMIT_EVENT_INVALID', retryInMs: null };
  }
  try {
    await queue.add('commit', data.data, {
      jobId: event.id,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
      removeOnFail: 100,
    });
    return { delivered: true };
  } catch {
    return {
      delivered: false,
      error: 'PACKAGE_IMPORT_COMMIT_QUEUE_RETRY',
      retryInMs: retryDelay(event.attempt),
    };
  }
}
