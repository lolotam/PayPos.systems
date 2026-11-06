import { ratingClaimsJob, RATING_CLAIMS_DISCOVERY } from '@pospay/contracts';
import type { ClaimedEvent, DeliveryOutcome } from '@pospay/db';
import type { Logger } from '@pospay/observability';
import { Queue, UnrecoverableError, Worker } from 'bullmq';
import { Redis } from 'ioredis';

import { retryDelayMs } from '../../../outbox/retry-policy.ts';
import type { RatingClaimsTurnSummary } from '../use-cases/claim-rating-requests/claim-rating-requests.ts';
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
 * @param failure الخطأ الأول اللي حصل
 * @param close القفل نفسه
 * @returns الخطأ الأول لو حصل
 */
async function closeQuietly(failure: unknown, close: () => Promise<void>): Promise<unknown> {
  try {
    await close();
  } catch (error) {
    return failure ?? error;
  }
  return failure;
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
      // بيانات المهمة غلط مش عطل مؤقت: إعادة المحاولة مش هتنفع، فالتكرار بس بيملا الطابور.
      if (!parsed.success) throw new UnrecoverableError('RATING_CLAIMS_JOB_INVALID');
      await options.turn.execute(parsed.data.companyId);
    },
    { connection, concurrency: 1, prefix },
  );
  worker.on('error', () => undefined);

  return {
    deliver: async (event, next) => {
      const discovery = event.eventType === RATING_CLAIMS_DISCOVERY;
      if (!discovery && !RATING_CLAIMS_TRIGGERS.includes(event.eventType)) return next(event);
      if (discovery && !validRatingClaimsDiscovery(event))
        return { delivered: false, error: 'RATING_CLAIMS_DISCOVERY_INVALID', retryInMs: null };
      try {
        await ensureRatingClaimsRegistered(queue, event.companyId);
      } catch (error) {
        options.logger?.warn({ err: error }, 'rating claims schedule failed');
        return {
          delivered: false,
          error: 'RATING_CLAIMS_SCHEDULE_RETRY',
          retryInMs: retryDelayMs(event.attempt),
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
      // بيتقفل برضه، والخطأ الأول بيت رمي في الآخر.
      let failure: unknown;
      failure = await closeQuietly(failure, () => worker.close());
      failure = await closeQuietly(failure, () => queue.close());
      failure = await closeQuietly(failure, () => closeRedisClient(producer));
      failure = await closeQuietly(failure, () => closeRedisClient(connection));
      if (failure !== undefined) throw failure;
    },
    ensureRegistered: async (companyId) => {
      await ensureRatingClaimsRegistered(queue, companyId);
    },
  };
}
