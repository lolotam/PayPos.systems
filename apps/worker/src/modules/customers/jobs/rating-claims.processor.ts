import { ratingClaimsJob } from '@pospay/contracts';
import type { ClaimedEvent, DeliveryOutcome } from '@pospay/db';
import type { Logger } from '@pospay/observability';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';

import { retryDelayMs } from '../../../outbox/retry-policy.ts';
import type { RatingClaimsTurnSummary } from '../use-cases/claim-rating-requests/claim-rating-requests.ts';

/** اسم طابور المطالبة، وهو نفسه بادئة معرّف الجدولة لكل شركة. */
export const RATING_CLAIMS_QUEUE = 'rating-claims';

/** الفترة بين جولتين متتاليتين لنفس الشركة: دقيقة واحدة. */
export const RATING_CLAIMS_EVERY_MS = 60_000;

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
  /** سجل العامل، اختياري عشانبيئات التشغيل الصامتة. */
  readonly logger?: Logger;
}

/** معالج المطالبة: يوجّه أحداث الزيارة إلى الجدولة، ويشغّل الدور من الطابور. */
export interface RatingClaimsProcessor {
  /**
   * يسجّل جدولة الشركة لو اتسجلت قبل، ويمرّر الحدث زي ما هو بعد كده.
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
 * يسجّل جدولة الشركة لو مش موجودة، من غير ما يعيد كتابة جدولة شغّالة.
 *
 * الجدولة الشغّالة معناها إن الدور بيتنفّذ كل دقيقة؛ إعادة كتابتها هتمسح التقدم
 * وتعيد الدور من أول حاجة.
 */
async function registerCompany(queue: Queue, companyId: string): Promise<void> {
  const schedulerId = `${RATING_CLAIMS_QUEUE}-${companyId}`;
  const existing = await queue.getJobScheduler(schedulerId);
  const parsed = ratingClaimsJob.safeParse(existing?.template?.data);
  if (parsed.success && parsed.data.companyId === companyId) return;
  await queue.upsertJobScheduler(
    schedulerId,
    { every: RATING_CLAIMS_EVERY_MS },
    {
      name: 'claim',
      data: { companyId },
      opts: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { age: 86_400 },
        removeOnFail: { age: 604_800 },
      },
    },
  );
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
  const connection = new Redis(options.redisUrl, {
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
  });
  connection.on('error', () => undefined);
  const producer = connection.duplicate({ maxRetriesPerRequest: 1, commandTimeout: 5000 });
  producer.on('error', () => undefined);
  const queue = new Queue(RATING_CLAIMS_QUEUE, { connection: producer, prefix });
  queue.on('error', () => undefined);
  const worker = new Worker(
    RATING_CLAIMS_QUEUE,
    async (job) => {
      const parsed = ratingClaimsJob.safeParse(job.data);
      if (!parsed.success) throw new TypeError('RATING_CLAIMS_JOB_INVALID');
      await options.turn.execute(parsed.data.companyId);
    },
    { connection, concurrency: 1, prefix },
  );
  worker.on('error', () => undefined);

  return {
    deliver: async (event, next) => {
      if (!RATING_CLAIMS_TRIGGERS.includes(event.eventType)) return next(event);
      try {
        await registerCompany(queue, event.companyId);
      } catch (error) {
        options.logger?.warn({ err: error }, 'rating claims schedule failed');
        return {
          delivered: false,
          error: 'RATING_CLAIMS_SCHEDULE_RETRY',
          retryInMs: retryDelayMs(event.attempt),
        };
      }
      return next(event);
    },
    ready: async () => {
      await worker.waitUntilReady();
      await queue.waitUntilReady();
    },
    close: async () => {
      await worker.close();
      await queue.close();
      await producer.quit();
      await connection.quit();
    },
    ensureRegistered: async (companyId) => {
      await registerCompany(queue, companyId);
    },
  };
}
