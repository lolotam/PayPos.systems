import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import {
  commissionStatementReminderEveryMs,
  commissionStatementReminderJob,
  commissionStatementReminderQueue,
  commissionStatementReminderSchedulerId,
} from '@pospay/contracts';
import type { Logger } from '@pospay/observability';

/** ما يحتاجه مسار التذكيرات: عنوان Redis والسجل. */
export interface CommissionReminderScheduleDependencies {
  readonly redisUrl: string;
  readonly logger: Logger;
  readonly prefix?: string;
}

/** المهلة الافتراضية لانتظار جاهزية اتصال Redis قبل تنفيذ أوامر الجدولة. */
const REDIS_READY_TIMEOUT_MS = 5_000;

/** ينتظر جاهزية اتصال Redis قبل إرسال أوامر الجدولة لأن `enableOfflineQueue: false` يرفض الأوامر المبكرة. */
function whenRedisReady(redis: Redis, timeoutMs = REDIS_READY_TIMEOUT_MS): Promise<void> {
  if (redis.status === undefined || redis.status === 'ready') return Promise.resolve();
  if (redis.status === 'end') return Promise.reject(new Error('REDIS_ENDED'));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      redis.off('ready', onReady);
      redis.off('end', onEnd);
      if (error === undefined) resolve();
      else reject(error);
    };
    const onReady = (): void => finish();
    const onEnd = (): void => finish(new Error('REDIS_ENDED'));
    const timer = setTimeout(() => finish(new Error('REDIS_READY_TIMEOUT')), timeoutMs);
    timer.unref?.();
    redis.on('ready', onReady);
    redis.on('end', onEnd);
    if (redis.status === 'ready') finish();
    else if (redis.status === 'wait') {
      void Promise.resolve(redis.connect()).catch((error: unknown) => {
        finish(error instanceof Error ? error : new Error('REDIS_CONNECT_FAILED'));
      });
    }
  });
}

/** يسجّل جدولة شركة في BullMQ بعد جاهزية Redis والطابور. */
async function registerReminderScheduler(
  queue: Queue,
  producer: Redis,
  companyId: string,
): Promise<{ registered: boolean; error?: string }> {
  try {
    await whenRedisReady(producer);
    await queue.waitUntilReady();
    await queue.upsertJobScheduler(
      commissionStatementReminderSchedulerId(companyId),
      { every: commissionStatementReminderEveryMs },
      {
        name: 'remind',
        data: commissionStatementReminderJob.parse({ companyId }),
        opts: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: true,
          removeOnFail: 100,
        },
      },
    );
    return { registered: true };
  } catch {
    return { registered: false, error: 'COMMISSION_REMINDER_SCHEDULE_RETRY' };
  }
}

/**
 * يبني سجلّ الجدولة على Redis: طابور واحد واسم جدولة لكل شركة، وبيانات المهمة هوية الشركة
 * وحدها. مفتاح الجدولة في Redis بالشكل اللي BullMQ بيستخدمه، عشان فحص وجودها يكون بنفس
 * مصدر التسجيل بالظبط.
 *
 * @param dependencies عنوان Redis والسجل
 * @returns الجدولة
 */
export function createCommissionReminderSchedule(
  dependencies: CommissionReminderScheduleDependencies,
): {
  register: (companyId: string) => Promise<{ registered: boolean; error?: string }>;
  exists: (companyId: string) => Promise<boolean>;
  existsAll: (companyIds: readonly string[]) => Promise<readonly boolean[]>;
  schedulerKeys: (companyIds: readonly string[]) => readonly string[];
  close: () => Promise<void>;
} {
  const prefix = dependencies.prefix ?? 'bull';
  const connection = new Redis(dependencies.redisUrl, {
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
  });
  connection.on('error', () => undefined);
  const producer = connection.duplicate({ maxRetriesPerRequest: 1, commandTimeout: 5000 });
  producer.on('error', () => undefined);
  const queue = new Queue(commissionStatementReminderQueue, { connection: producer, prefix });
  queue.on('error', () => undefined);
  const keyOf = (companyId: string): string =>
    `${prefix}:${commissionStatementReminderQueue}:repeat:${commissionStatementReminderSchedulerId(companyId)}`;
  return {
    register: (companyId) => registerReminderScheduler(queue, producer, companyId),
    exists: async (companyId) => {
      await whenRedisReady(producer);
      return (await producer.exists(keyOf(companyId))) === 1;
    },
    existsAll: async (companyIds) => {
      if (companyIds.length === 0) return [];
      await whenRedisReady(producer);
      const pipeline = producer.pipeline();
      for (const companyId of companyIds) pipeline.exists(keyOf(companyId));
      const results = await pipeline.exec();
      return (results ?? []).map((entry) => entry?.[1] === 1);
    },
    schedulerKeys: (companyIds) => companyIds.map((companyId) => keyOf(companyId)),
    close: async () => {
      await queue.close();
      producer.disconnect();
      connection.disconnect();
    },
  };
}

/**
 * يشغّل عامل الطابور: مهمة كل ساعة لكل شركة، بتقرأ الشهر السابق وتبعت التذكيرات.
 *
 * @param redisUrl عنوان Redis
 * @param execute  تشغيل التذكيرات لشركة
 * @param prefix   بادئة مفاتيح BullMQ
 * @returns العامل مع دالة قفله
 */
export function startCommissionReminderWorker(
  redisUrl: string,
  execute: (companyId: string) => Promise<unknown>,
  prefix = 'bull',
): { worker: Worker; close: () => Promise<void> } {
  const connection = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
  });
  connection.on('error', () => undefined);
  const worker = new Worker(
    commissionStatementReminderQueue,
    async (job) => {
      const data = commissionStatementReminderJob.safeParse(job.data);
      if (!data.success) throw new Error('COMMISSION_REMINDER_JOB_INVALID');
      await execute(data.data.companyId);
    },
    { connection, concurrency: 1, prefix },
  );
  worker.on('error', () => undefined);
  return {
    worker,
    close: async () => {
      await worker.close();
      connection.disconnect();
    },
  };
}
