import type { ClaimedEvent, DeliveryOutcome, TenantWrappers } from '@pospay/db';
import {
  FakePushChannel,
  notificationRedisOptions,
  readPushApiConfiguration,
  readPushWorkerConfiguration,
  WebPushChannel,
  type PushChannel,
  type PushWorkerConfiguration,
} from '@pospay/notifications';
import type { Logger } from '@pospay/observability';
import { Worker, type Queue } from 'bullmq';
import type { Redis } from 'ioredis';

import { retryDelayMs } from '../../outbox/retry-policy.ts';
import { closeOptional, optionalWithin } from '../../shared/optional-capability.ts';
import { notificationQueue } from './jobs/notification-queue.ts';
import { createPushTransport, PUSH_SEND_QUEUE } from './jobs/push-queue.ts';
import { pushProcessor } from './jobs/push-send.processor.ts';
import type { Clock } from './ports/clock.port.ts';
import type { IdGenerator } from './ports/id-generator.port.ts';
import { createPushDeliveryRepository } from './persistence/drizzle-push-delivery.repository.ts';
import { createPushRequestBuilder } from './persistence/push-request.builder.ts';
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
    // حدث إذن الدفع ما بيترجعش للتسليم العادي؛ هو يفضل في الـ outbox لحد ما الدفع يتفعّل.
    // بعد آخر محاولة في سياسة الـ outbox (عشرة) الحدث بيتوقف زي أي حدث سام، والمشغّل بيعيد تشغيله
    // لما الدفع يبقى جاهز.
    transport: (next) => (event) => {
      if (event.eventType !== 'PushSendAuthorized') return next(event);
      return Promise.resolve({
        delivered: false,
        error: 'PUSH_DISABLED',
        retryInMs: retryDelayMs(event.attempt),
      });
    },
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
 * يبني قناة الدفع الحقيقية من مفاتيح VAPID المقروءة.
 * القاعدة: القناة الحقيقية بتوقّع المفتاحين مع بعض، والمزيفة بتختارها في التجهيز مش هنا.
 *
 * @param configuration إعداد الدفع المقروء
 * @param clock         ساعة العامل
 * @returns قناة الدفع
 */
export function bindPushChannel(configuration: PushWorkerConfiguration, clock: Clock): PushChannel {
  return new WebPushChannel({
    vapid: {
      subject: configuration.subject,
      publicKey: configuration.publicKey,
      privateKey: configuration.privateKey,
    },
    now: () => clock.now(),
  });
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
  let binding: PushBinding;
  try {
    binding = bindPushCapability(options);
  } catch {
    // ربط القناة بيقفل فاشل لو الزوج غير متسق؛ ده زي أي فشل تاني في التجهيز.
    await unavailable(options.logger);
    return disabledCapability();
  }
  if (binding.kind === 'disabled') {
    options.logger.info(
      { capability: { name: 'STAFF_PUSH', state: 'DISABLED', reason: binding.reason } },
      'staff push capability',
    );
    return disabledCapability();
  }
  const send = new SendPush(
    createPushDeliveryRepository(options.database),
    createPushRequestBuilder(),
    binding.channel,
    redisPushAdmission(options.redis),
    binding.keyId,
    options.clock,
    options.ids,
  );
  let queue: PushQueue | undefined;
  try {
    const started = await start(options.redisUrl, send, options.logger);
    queue = started;
    await optionalWithin(() => started.ready());
    options.logger.info(
      { capability: { name: 'STAFF_PUSH', state: 'READY', keyId: binding.keyId } },
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

/** نتيجة تجهيز قدرة الدفع: مقفولة بسبب محدود، أو جاهزة بقناة ومعرّف مفتاح (>null لما مفيش مفتاح). */
type PushBinding =
  | { readonly kind: 'disabled'; readonly reason: string }
  | { readonly kind: 'ready'; readonly channel: PushChannel; readonly keyId: string | null };

// الوضع المزيف محتاجش مفاتيح (FR-011)، والإنتاج رفضه؛ وكل حالة تانية بتقرأ الجاهزية.
function bindPushCapability(options: PushStartupOptions): PushBinding {
  const mode = options.env['NOTIFICATIONS_MODE'];
  if (options.production && mode === 'fake')
    return { kind: 'disabled', reason: 'FAKE_IN_PRODUCTION' };
  if (!options.production && mode === 'fake')
    return {
      kind: 'ready',
      channel: new FakePushChannel(options.clock.now),
      keyId: readPushApiConfiguration(options.env)?.keyId ?? null,
    };
  const readiness = readPushWorkerConfiguration(options.env);
  if (!readiness.ready) return { kind: 'disabled', reason: readiness.reason };
  return {
    kind: 'ready',
    channel: bindPushChannel(readiness.configuration, options.clock),
    keyId: readiness.configuration.keyId,
  };
}
