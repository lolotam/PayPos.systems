import { ratingClaimsJob, RATING_CLAIMS_DISCOVERY } from '@pospay/contracts';
import type { ClaimedEvent, DeliveryOutcome } from '@pospay/db';
import { errorDiagnostic, type Logger } from '@pospay/observability';
import { Queue, UnrecoverableError, Worker } from 'bullmq';
import { Redis } from 'ioredis';

import type { RatingClaimsTurnSummary } from '../use-cases/claim-rating-requests/claim-rating-requests.ts';
import { ratingClaimsScheduleRetryDelayMs } from '../use-cases/claim-rating-requests/claim-rating-requests.ts';
import { RATING_CLAIMS_QUEUE, ensureRatingClaimsRegistered } from './rating-claims.registration.ts';
import { validRatingClaimsDiscovery } from './rating-claims-discovery.ts';
export { RATING_CLAIMS_QUEUE, RATING_CLAIMS_EVERY_MS } from './rating-claims.registration.ts';

/** أحداث الزيارة اللي بتعمل جدولة شركة، من غير أي حدث اكتشاف. */
export const RATING_CLAIMS_TRIGGERS: readonly string[] = [
  'ServiceSessionRecorded',
  'ServiceSessionLinesAdded',
  'ServiceLineChanged',
];

/** منفذ دور المطالبة: دور خدمة واحدة للشركة. */
export interface RatingClaimsTurnPort {
  /**
   * يشغّل دور خدمة واحدة للشركة.
   *
   * @param companyId الشركة المالكة للحالة
   * @returns ملخص الدور المنقّى
   */
  execute(companyId: string): Promise<RatingClaimsTurnSummary>;
}

/** إعدادات معالج المطالبة: الاتصال بالطابور، والبادئة، ودور المطالبة نفسه. */
export interface RatingClaimsProcessorOptions {
  /** رابط Redis اللي الطابور والعامل بيشتغلوا عليه. */
  readonly redisUrl: string;
  /** بادئة مفاتيح BullMQ؛ كل بيئة ليها بادئة. */
  readonly prefix?: string;
  /** دور المطالبة اللي العامل بيناديه. */
  readonly turn: RatingClaimsTurnPort;
  /** سجل العامل، اختياري عشان بيئات التشغيل الصامتة. */
  readonly logger?: Logger;
  /**
   * وقت إعادة المحاولة بين تسجيلات الجدولة، والحقنة بتقدّمه بدل القيمة
   * الافتراضية عشان الاختبار يقدر يثبّت السلسلة.
   */
  readonly retryDelayMs?: (attempt: number) => number | null;
}

/** معالج المطالبة: يوجّه أحداث الزيارة إلى الجدولة، ويشغّل الدور من الطابور. */
export interface RatingClaimsProcessor {
  /**
   * يسجّل جدولة الشركة لو الجدولة ناقصة، وبيسجّلها بس لأحداث الزيارة المعرّفة
   * في RATING_CLAIMS_TRIGGERS ولحدث الاكتشاف المستقل؛ وأي حدث تاني بيمرّ على طول. ولو التسجيل فشل
   * بيرجّع RATING_CLAIMS_SCHEDULE_RETRY عشان المرسّل يعيد المحاولة.
   *
   * @param event الحدث المسلّم من المرسِل
   * @param next المسلّم التالي للأحداث التانية
   * @returns نتيجة التسليم
   */
  deliver(
    event: ClaimedEvent,
    next: (event: ClaimedEvent) => Promise<DeliveryOutcome>,
  ): Promise<DeliveryOutcome>;

  /**
   * ينتظر جهوزية العامل والطابور.
   *
   * @returns لا شيء
   */
  ready(): Promise<void>;

  /**
   * يصفّي العامل، وبعدين يقفل الطابور والاتصالات.
   *
   * @returns لا شيء
   */
  close(): Promise<void>;

  /**
   * يسجّل جدولة الشركة من غير ما يمسّ أي جدولة شغّالة.
   *
   * @param companyId الشركة اللي جدولتها مطلوبة
   * @returns لا شيء
   */
  ensureRegistered(companyId: string): Promise<void>;
}

/**
 * يقفل عميل Redis على حسب حالته.
 *
 * العميل اللي لسه متصل بيتقفل قفل نظيف، واللي خلص يقفل خلاص ما يعملش حاجة،
 * واللي في نص الاتصال بيقطع الاتصال من غير ما ينتظر رد.
 *
 * @param client عميل Redis اللي بيتقفل
 * @returns لا شيء
 */
export async function closeRedisClient(client: Redis): Promise<void> {
  if (client.status === 'ready') {
    await client.quit();
    return;
  }
  if (client.status === 'end') return;
  client.disconnect();
}

/**
 * يقفل مورد وبيجمّع الخطأ بدل ما يوقف الباقي.
 *
 * @param failures الأخطاء اللي اتجمعت لحد دلوقتي
 * @param close القفل نفسه
 * @returns لا شيء
 */
async function closeQuietly(failures: unknown[], close: () => Promise<void>): Promise<void> {
  try {
    await close();
  } catch (error) {
    failures.push(error);
  }
}

/**
 * يرمي الأخطاء اللي اتجمعت أثناء الإغلاق.
 *
 * خطأ واحد بيترمي زي ما هو، وعند كذا خطأ بيتلمّوا في AggregateError واحد عشان
 * المشغّل يشوف كل أسباب الإغلاق مرة واحدة.
 *
 * @param failures الأخطاء اللي اتجمعت
 * @returns لا شيء
 */
function throwCloseFailures(failures: readonly unknown[]): void {
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError([...failures], 'RATING_CLAIMS_CLOSE_FAILED');
}

/**
 * يسجل خطأ اتصال أو طابور من غير نسبة الشركة: الفشل عام على البنية كلها.
 *
 * @param logger سجل العامل، وممكن يكون مش موجود
 * @param component اسم الجزء اللي فشل
 * @param error الخطأ اللي حصل
 * @returns لا شيء
 */
function logQueueError(logger: Logger | undefined, component: string, error: unknown): void {
  logger?.warn({ err: errorDiagnostic(error), component }, 'rating claims queue error');
}

/**
 * موارد الطابور والعامل على Redis، وبالمعالجات بتاعها للأخطاء.
 */
interface QueueResources {
  readonly queue: Queue;
  readonly worker: Worker;
  readonly producer: Redis;
  readonly connection: Redis;
}

/** يبني الطابور والعامل والاتصالين، ويسمع أخطاء كل واحد فيهم. */
function buildQueueResources(
  options: RatingClaimsProcessorOptions,
  prefix: string,
): QueueResources {
  const connection = new Redis(options.redisUrl, {
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
  });
  connection.on('error', (error: unknown) => logQueueError(options.logger, 'connection', error));
  const producer = connection.duplicate({ maxRetriesPerRequest: 1, commandTimeout: 5000 });
  producer.on('error', (error: unknown) => logQueueError(options.logger, 'producer', error));
  const queue = new Queue(RATING_CLAIMS_QUEUE, { connection: producer, prefix });
  queue.on('error', (error: unknown) => logQueueError(options.logger, 'queue', error));
  const worker = new Worker(
    RATING_CLAIMS_QUEUE,
    async (job) => {
      const parsed = ratingClaimsJob.safeParse(job.data);
      // بيانات المهمة غلط مش عطل مؤقت: إعادة المحاولة مش هتنفع، فالتكرار بس بيملا الطابور.
      if (!parsed.success) throw new UnrecoverableError('RATING_CLAIMS_JOB_INVALID');
      await options.turn.execute(parsed.data.companyId);
    },
    { connection, concurrency: 1, prefix },
  );
  worker.on('error', (error: unknown) => logQueueError(options.logger, 'worker', error));
  worker.on('failed', (job, error: unknown) => {
    options.logger?.error(
      { ...failedJobFields(job), err: errorDiagnostic(error) },
      'rating claims job failed',
    );
  });
  return { queue, worker, producer, connection };
}

/**
 * يبني معالج المطالبة: طابور وعامل على Redis، ودور المطالبة جواهم.
 *
 * بيانات المهمة هوية الشركة بس، والعامل ما بيكتبش في بيانات المهمة أبداً.
 */
export function startRatingClaimsProcessor(
  options: RatingClaimsProcessorOptions,
): RatingClaimsProcessor {
  const prefix = options.prefix ?? 'bull';
  const retryDelay = options.retryDelayMs ?? ratingClaimsScheduleRetryDelayMs;
  const { queue, worker, producer, connection } = buildQueueResources(options, prefix);
  return {
    deliver: async (event, next) => {
      const discovery = event.eventType === RATING_CLAIMS_DISCOVERY;
      if (!discovery && !RATING_CLAIMS_TRIGGERS.includes(event.eventType)) return next(event);
      if (discovery && !validRatingClaimsDiscovery(event))
        return { delivered: false, error: 'RATING_CLAIMS_DISCOVERY_INVALID', retryInMs: null };
      try {
        await ensureRatingClaimsRegistered(queue, event.companyId);
      } catch (error) {
        options.logger?.warn(
          {
            event: 'registration_failed',
            company_id: event.companyId,
            event_id: event.id,
            event_type: event.eventType,
            attempt: event.attempt,
            err: errorDiagnostic(error),
          },
          'rating claims schedule failed',
        );
        return {
          delivered: false,
          error: 'RATING_CLAIMS_SCHEDULE_RETRY',
          retryInMs: retryDelay(event.attempt),
        };
      }
      return discovery ? { delivered: true } : next(event);
    },
    ready: async () => {
      await worker.waitUntilReady();
      await queue.waitUntilReady();
    },
    close: async () => {
      // العامل بيتصفّى الأول، وبعدين الطابور واتصالات Redis؛ لو عنصر فشل، الباقي
      // بيتقفل برضه، وكل الأخطاء بتتجمع.
      const failures: unknown[] = [];
      await closeQuietly(failures, () => worker.close());
      await closeQuietly(failures, () => queue.close());
      await closeQuietly(failures, () => closeRedisClient(producer));
      await closeQuietly(failures, () => closeRedisClient(connection));
      throwCloseFailures(failures);
    },
    ensureRegistered: async (companyId) => {
      await ensureRatingClaimsRegistered(queue, companyId);
    },
  };
}

/**
 * حقول المهمة الفاشلة: هوية الشركة بتظهر بس لما بيانات المهمة تعدّي التحقق.
 *
 * ما فيش تخمين: من غير بيانات صالحة ما فيش company_id ولا user_id ولا branch_id.
 *
 * @param job المهمة الفاشلة
 * @returns الحقول الآمنة اللي بتتسجل
 */
function failedJobFields(
  job: { data?: unknown; id?: string; attemptsMade?: number } | undefined,
): Record<string, unknown> {
  const parsed = job === undefined ? undefined : ratingClaimsJob.safeParse(job.data);
  const fields: Record<string, unknown> = {};
  if (parsed?.success === true) fields['company_id'] = parsed.data.companyId;
  if (job?.id !== undefined) fields['job_id'] = job.id;
  if (job?.attemptsMade !== undefined) fields['attempts_made'] = job.attemptsMade;
  return fields;
}
