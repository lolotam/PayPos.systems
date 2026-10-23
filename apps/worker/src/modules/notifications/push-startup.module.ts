import type { ClaimedEvent, DeliveryOutcome, TenantWrappers } from '@pospay/db';
import {
  FakePushChannel,
  notificationRedisOptions,
  readPushWorkerConfiguration,
  WebPushChannel,
  type PushChannel,
  type PushWorkerConfiguration,
} from '@pospay/notifications';
import type { Logger } from '@pospay/observability';
import { Worker, type Queue } from 'bullmq';
import type { Redis } from 'ioredis';

import { closeOptional, optionalWithin } from '../../shared/optional-capability.ts';
import { notificationQueue } from './jobs/notification-queue.ts';
import { createPushTransport, PUSH_SEND_QUEUE } from './jobs/push-queue.ts';
import { pushProcessor } from './jobs/push-send.processor.ts';
import type { Clock } from './ports/clock.port.ts';
import type { IdGenerator } from './ports/id-generator.port.ts';
import { createPushDeliveryRepository } from './persistence/drizzle-push-delivery.repository.ts';
import { redisPushAdmission } from './persistence/redis-push-admission.ts';
import { SendPush } from './use-cases/send-push/send-push.ts';

/** طابور الدفع: الطابور نفسه وجاهزيته وإيقافه وإغلاقه. */
export interface PushQueue {
  readonly queue: Pick<Queue, 'add'>;
  ready(): Promise<void>;
  stop(): Promise<void>;
  close(force?: boolean): Promise<void>;
}

/** دالة بدء الطابور: بتُحقن في الاختبار عشان مفيش Redis لازم. */
export type PushQueueStarter = (
  redisUrl: string,
  send: SendPush,
  logger: Logger,
) => PushQueue | Promise<PushQueue>;

/** جاهزية الدفع في العامل: هل هو شغّال، ووين يروح حدث الإذن، وإزاي يتقفل. */
export interface PushCapability {
  readonly enabled: boolean;
  transport(
    next: (event: ClaimedEvent) => Promise<DeliveryOutcome>,
  ): (event: ClaimedEvent) => Promise<DeliveryOutcome>;
  stop(): Promise<void>;
  close(force?: boolean): Promise<void>;
}

export interface PushStartupOptions {
  readonly env: NodeJS.ProcessEnv;
  readonly production: boolean;
  readonly logger: Logger;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly database: Pick<TenantWrappers, 'withTenant'>;
  readonly redisUrl: string;
  readonly redis: Pick<Redis, 'eval'>;
}

function disabledCapability(): PushCapability {
  return {
    enabled: false,
    transport: (next) => next,
    stop: async () => undefined,
    close: async () => undefined,
  };
}

async function unavailable(logger: Logger, queue?: PushQueue): Promise<void> {
  logger.warn(
    { capability: { name: 'STAFF_PUSH', state: 'UNAVAILABLE', reason: 'SETUP_FAILED' } },
    'staff push capability',
  );
  await closeOptional([() => queue?.close(true)]);
}

/**
 * يختار قناة الدفع: المزيفة خارج الإنتاج وبوضع fake بس، وكل حالة تانية قناة حقيقية.
 * القاعدة: الـ staging بيشتغل NODE_ENV=production والوضع المزيف افتراضي، فلازم يبعت دفع حقيقي
 * لما مفاتيح VAPID تكون متركّبة.
 *
 * @param env           بيئة العملية
 * @param production    هل العامل في الإنتاج
 * @param clock         ساعة العامل
 * @param configuration إعداد الدفع المقروء
 * @returns قناة الدفع
 */
export function bindPushChannel(
  env: NodeJS.ProcessEnv,
  production: boolean,
  clock: Clock,
  configuration: PushWorkerConfiguration,
): PushChannel {
  if (!production && env['NOTIFICATIONS_MODE'] === 'fake') return new FakePushChannel(clock.now);
  return new WebPushChannel({
    vapid: {
      subject: configuration.subject,
      publicKey: configuration.publicKey,
      privateKey: configuration.privateKey,
    },
    now: () => clock.now(),
  });
}

// ربط القناة ممكن يفشل لو الزوج غير متسق؛ الفشل ده زي أي فشل تاني في التجهيز.
function bindPushChannelOrNull(
  options: PushStartupOptions,
  configuration: PushWorkerConfiguration,
): PushChannel | null {
  try {
    return bindPushChannel(options.env, options.production, options.clock, configuration);
  } catch {
    return null;
  }
}

/**
 * يفتح طابور الدفع وعامله بالاتصال اللي بتاعه.
 * القاعدة: الخطأ بيتسجل من غير بيانات، والإيقاف بيقفل العامل بس والإغلاق بيقفل الطابور كمان.
 *
 * @param redisUrl رابط Redis
 * @param send    حالة الدفع المرخّصة
 * @param logger  سجل العامل
 * @returns الطابور مع جاهزيته
 */
export function startPushQueue(redisUrl: string, send: SendPush, logger: Logger): PushQueue {
  const connection = notificationRedisOptions(redisUrl);
  const resource = notificationQueue(PUSH_SEND_QUEUE, connection, () =>
    logger.warn({}, 'push queue error'),
  );
  const queue = resource.queue;
  const worker = new Worker(PUSH_SEND_QUEUE, pushProcessor(send, logger), {
    connection,
    concurrency: 4,
  });
  const logError = (error: unknown) => logger.warn({ err: error }, 'push queue error');
  queue.on('error', logError);
  worker.on('error', logError);
  worker.on('failed', (job, error) =>
    logger.warn({ event: { id: job?.id }, err: error }, 'push job failed'),
  );
  return {
    queue,
    ready: async () => {
      await queue.waitUntilReady();
      await worker.waitUntilReady();
    },
    stop: () => worker.close(),
    close: async (force = false) => {
      await Promise.allSettled([worker.close(force), resource.close(force)]);
    },
  };
}

/**
 * يشغّل قدرة الدفع في العامل.
 * القاعدة: الجاهزية مقسومة (ADR-0052 قرار 2): الإرسال بيتفعّل بس لما التلات متغيرات تكون صحيحة
 * والمفتاحين متوافقين؛ وإلا القدرة بتقفل ومحدش بيكتب محاولات مفيش اللي يبعتها.
 *
 * @param options إعدادات البدء
 * @param start   دالة فتح الطابور، بتُحقن في الاختبار
 * @returns قدرة الدفع
 */
export async function startPushCapability(
  options: PushStartupOptions,
  start: PushQueueStarter = startPushQueue,
): Promise<PushCapability> {
  const readiness = readPushWorkerConfiguration(options.env);
  if (!readiness.ready) {
    options.logger.info(
      { capability: { name: 'STAFF_PUSH', state: 'DISABLED', reason: readiness.reason } },
      'staff push capability',
    );
    return disabledCapability();
  }
  const configuration = readiness.configuration;
  const channel = bindPushChannelOrNull(options, configuration);
  if (channel === null) {
    await unavailable(options.logger);
    return disabledCapability();
  }
  const send = new SendPush(
    createPushDeliveryRepository(options.database),
    channel,
    redisPushAdmission(options.redis),
    configuration.keyId,
    options.clock,
    options.ids,
  );
  let queue: PushQueue | undefined;
  try {
    const started = await start(options.redisUrl, send, options.logger);
    queue = started;
    await optionalWithin(() => started.ready());
    options.logger.info(
      { capability: { name: 'STAFF_PUSH', state: 'READY', keyId: configuration.keyId } },
      'staff push capability',
    );
    return {
      enabled: true,
      transport: (next) => createPushTransport(started.queue, next, options.logger),
      stop: () => started.stop(),
      close: (force = false) => started.close(force),
    };
  } catch {
    await unavailable(options.logger, queue);
    return disabledCapability();
  }
}
