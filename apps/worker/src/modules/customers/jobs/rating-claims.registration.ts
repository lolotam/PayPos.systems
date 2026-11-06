import { ratingClaimsJob } from '@pospay/contracts';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

/** اسم طابور المطالبة، وهو نفسه بادئة معرّف الجدولة لكل شركة. */
export const RATING_CLAIMS_QUEUE = 'rating-claims';
/** الفترة بين جولتين متتاليتين لنفس الشركة: دقيقة واحدة. */
export const RATING_CLAIMS_EVERY_MS = 60_000;

/** انتهاء مهلة الإقلاع الأولى؛ ثابت النص ولا يكشف عنوان Redis. */
export class RatingClaimsReadinessError extends Error {
  readonly code = 'RATING_CLAIMS_REDIS_READY_TIMEOUT';
  constructor() {
    super('RATING_CLAIMS_REDIS_READY_TIMEOUT');
  }
}

async function registrationReady(queue: Queue, redis: Redis): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      queue.waitUntilReady(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new RatingClaimsReadinessError()), 5_000);
      }),
    ]);
  } catch (error) {
    // نوقف reconnect قبل الإغلاق حتى لا يحتفظ الإقلاع المتعثر باتصال يحاول للأبد.
    redis.disconnect();
    await Promise.allSettled([queue.close()]);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** تسجيل فقط: لا يبني Worker للمطالبة، فلا يفعل إرسالًا أثناء الاستعادة. */
export interface RatingClaimsRegistrar {
  /** يسجل الشركة أو يصلح جدولتها المفقودة دون تغيير بيانات مطالبة موجودة. */
  ensureRegistered(companyId: string): Promise<void>;
  /** يتأكد من جهوزية طابور التسجيل. */
  ready(): Promise<void>;
  /** يقفل طابور التسجيل واتصاله حتى لو أخفق أحدهما. */
  close(): Promise<void>;
}

/**
 * يسجّل جدولة الشركة لو مش موجودة، من غير ما يعيد كتابة جدولة شغّالة.
 *
 * إعادة كتابة الجدولة بتعيد ضبط توقيت الدور، فالزيارة الجديدة كانت بتأجّل الدور
 * كل مرة وبتخليه ما يوصلش لنهاية جولته.
 * التسجيل الحي والاستعادة يستخدمان القاعدة نفسها دون لمس حالة السور أو مؤشرات المطالبة.
 */
export async function ensureRatingClaimsRegistered(queue: Queue, companyId: string): Promise<void> {
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

/** يبني تسجيل الاستعادة دون عامل؛ جذر المشغّل يغلقه بعد انتهاء الصفحات. */
export function startRatingClaimsRegistrar(options: {
  redisUrl: string;
  prefix?: string;
}): RatingClaimsRegistrar {
  const redis = new Redis(options.redisUrl, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    commandTimeout: 5_000,
  });
  // فشل الاتصال يصل إلى أمر التسجيل؛ لا نطبع error يحمل رابطًا أو مفاتيح.
  redis.on('error', () => undefined);
  const queue = new Queue(RATING_CLAIMS_QUEUE, {
    connection: redis,
    prefix: options.prefix ?? 'bull',
  });
  queue.on('error', () => undefined);
  return {
    ensureRegistered: (companyId) => ensureRatingClaimsRegistered(queue, companyId),
    ready: () => registrationReady(queue, redis),
    close: async () => {
      let failure: unknown;
      try {
        await queue.close();
      } catch (error) {
        failure = error;
      }
      try {
        if (redis.status === 'ready') await redis.quit();
      } catch (error) {
        failure ??= error;
      } finally {
        redis.disconnect();
      }
      if (failure !== undefined) throw failure;
    },
  };
}
