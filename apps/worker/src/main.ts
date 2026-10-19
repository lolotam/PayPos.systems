import { createDatabase, createOutboxDispatcherDatabase } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import { Redis } from 'ioredis';

import { createDeliverer } from './outbox/deliver.ts';
import { knownEventTypes } from './outbox/known-event-types.ts';
import {
  createNotificationModule,
  createInAppNotificationModule,
  readNotificationConfiguration,
  startEmailCapability,
} from './modules/notifications/index.ts';
import { createDispatchLoop } from './outbox/dispatch-loop.ts';
import { readConfig } from './shared/config.ts';
import { WORKER_LOG_EVENTS } from './shared/log-events.ts';
import { createWorker } from './worker.ts';
import { startFilesWorker } from './modules/files/index.ts';
import { deliverFilesEvent } from './outbox/files-deliver.ts';
import {
  startOptionalCapabilities,
  type OptionalCapabilities,
} from './start-optional-capabilities.ts';
import { createStaffDocumentDefaults, startStaffWorker } from './modules/staff/index.ts';
import {
  createLateServiceSessionNoticeConsumer,
  createLineCancelNoticeConsumer,
  createPriceEditNoticeConsumer,
} from './modules/orders/index.ts';
import { closeOptional, optionalWithin } from './shared/optional-capability.ts';

const config = readConfig(process.env);
const logger = createLogger(config.LOG_LEVEL, { events: WORKER_LOG_EVENTS });

const app = createDatabase({ url: config.DATABASE_URL, ids: systemUuidV7() });
const dispatcher = createOutboxDispatcherDatabase({ url: config.DISPATCHER_DATABASE_URL });
const redis = new Redis(config.REDIS_URL, { enableOfflineQueue: false, maxRetriesPerRequest: 1 });
// Attached before any connection event, so ioredis never prints raw errors outside the logger.
redis.on('error', (error: unknown) => logger.warn({ err: error }, 'redis connection error'));

// ADR-0019: استقبال STOP وin-app مستقلان؛ تفعيل OTP لا يفتح إرسال الشركات.
const production = process.env['NODE_ENV'] === 'production';
const files = startFilesWorker(app, systemUuidV7(), config.REDIS_URL, process.env);
const staff = startStaffWorker(app, systemUuidV7(), config.REDIS_URL, { now: () => new Date() });
const email = await startEmailCapability({
  env: process.env,
  production,
  logger,
  ids: systemUuidV7(),
  clock: { now: () => new Date() },
});
let notifications: ReturnType<typeof createNotificationModule> | null = null;
if (!production) {
  try {
    notifications = createNotificationModule({
      database: app,
      ids: systemUuidV7(),
      clock: { now: () => new Date() },
      configuration: readNotificationConfiguration(process.env),
      production,
      email: email.module,
    });
  } catch {
    logger.warn(
      { capability: { name: 'TENANT_WHATSAPP', state: 'UNAVAILABLE', reason: 'SETUP_FAILED' } },
      'staff OTP capability',
    );
  }
}
const inApp = production
  ? createInAppNotificationModule({
      database: app,
      ids: systemUuidV7(),
      clock: { now: () => new Date() },
      email: email.module,
    })
  : null;
if (production)
  logger.info(
    { capability: { name: 'TENANT_WHATSAPP', state: 'DISABLED', reason: 'LIVE_NOT_AUTHORIZED' } },
    'staff OTP capability',
  );
let globalDatabase: OptionalCapabilities['database'];
let inbound: OptionalCapabilities['inbound'];
let otp: OptionalCapabilities['otp'];
let otpAuth: OptionalCapabilities['auth'];
let capabilityTimer: OptionalCapabilities['timer'];
let stopping = false;
let maintenance: OptionalCapabilities['maintenance'];
const businessDeliver = createDeliverer(
  app,
  [
    files.consumer,
    ...(notifications === null
      ? inApp === null
        ? []
        : [inApp.consumer]
      : [notifications.consumer]),
    createStaffDocumentDefaults(systemUuidV7()),
    createLateServiceSessionNoticeConsumer(systemUuidV7(), { now: () => new Date() }),
    createPriceEditNoticeConsumer(systemUuidV7(), { now: () => new Date() }),
    createLineCancelNoticeConsumer(systemUuidV7(), { now: () => new Date() }),
  ],
  logger,
  { knownEventTypes: knownEventTypes(staff, notifications, inApp) },
);
let queue: OptionalCapabilities['queue'];
const deliver: typeof businessDeliver = (event) =>
  deliverFilesEvent(event, {
    register: (claimed) => files.deliver(claimed),
    staff: (claimed, next) => staff.deliver(claimed, next),
    core: (claimed) => (queue?.deliver ?? businessDeliver)(claimed),
  });
const loop = createDispatchLoop({ dispatcher, deliver, logger });

const release = async (): Promise<void> => {
  stopping = true;
  clearInterval(capabilityTimer);
  // ننتظر فحص الملفات الجاري قبل إغلاق اتصال قاعدة البيانات.
  await files.close();
  await staff.close();
  await optionalWithin(
    () =>
      Promise.allSettled([
        inbound?.close(true),
        otp?.close(true),
        otpAuth?.close(),
        maintenance?.close(),
        globalDatabase?.close(true),
        queue?.close(true),
        email.close(),
        dispatcher.close(),
        app.close(),
        redis.quit(),
      ]),
    5000,
  ).catch(() => undefined);
  redis.disconnect();
};

try {
  const started = await startOptionalCapabilities({
    env: process.env,
    logger,
    notifications,
    redisUrl: config.REDIS_URL,
    businessDeliver,
    intakeUrl: config.PLATFORM_NOTIFICATIONS_DATABASE_URL,
    redis,
    stopping: () => stopping,
  });
  maintenance = started.maintenance;
  queue = started.queue;
  globalDatabase = started.database;
  inbound = started.inbound;
  otp = started.otp;
  otpAuth = started.auth;
  capabilityTimer = started.timer;
  const worker = await createWorker(
    {
      readiness: [
        { name: 'database', check: () => app.ping() },
        // A wrong dispatcher URL or password leaves the worker with nothing to do — it is not ready.
        { name: 'dispatcher', check: () => dispatcher.ping() },
        {
          name: 'redis',
          check: async () => {
            await redis.ping();
          },
        },
      ],
      stopPolling: async () => {
        stopping = true;
        email.stop();
        maintenance?.stop();
        await loop.stop();
        await closeOptional([() => queue?.stop(), () => inbound?.stop()]);
        clearInterval(capabilityTimer);
        await closeOptional([() => otp?.stop()]);
      },
      release,
    },
    logger,
  );
  worker.enableShutdownHooks();
  await worker.listen({ host: config.WORKER_HOST, port: config.WORKER_PORT });
  loop.start();
} catch (error) {
  // Only the sanitised diagnostic is logged — the error's message can carry a connection string.
  logger.fatal({ err: error }, 'worker failed to start');
  await loop.stop();
  await release();
  process.exit(1);
}
