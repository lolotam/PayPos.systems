import {
  createDatabase,
  createOutboxDispatcherDatabase,
  createPlatformWhatsappDatabase,
} from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import {
  createStaffOtpExecution,
  createStaffOtpMaintenance,
  readStaffOtpConfiguration,
  type StaffOtpExecution,
} from '@pospay/auth';
import {
  createPhoneIdentity,
  phoneLockKey,
  readOtpTemplateApproval,
  readWhatsappWebhookConfiguration,
} from '@pospay/notifications';
import { createLogger } from '@pospay/observability';
import { Redis } from 'ioredis';

import { createDeliverer } from './outbox/deliver.ts';
import {
  createNotificationModule,
  createInAppNotificationModule,
  startWhatsappInbound,
  readNotificationConfiguration,
  startNotificationQueue,
  startStaffOtpWorker,
  startEmailCapability,
} from './modules/notifications/index.ts';
import { createDispatchLoop } from './outbox/dispatch-loop.ts';
import { readConfig } from './shared/config.ts';
import { WORKER_LOG_EVENTS } from './shared/log-events.ts';
import { createWorker } from './worker.ts';
import { startFilesWorker } from './modules/files/index.ts';
import { createStaffDocumentDefaults, startStaffWorker } from './modules/staff/index.ts';
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
const intakeUrl = config.PLATFORM_NOTIFICATIONS_DATABASE_URL;
let globalDatabase: ReturnType<typeof createPlatformWhatsappDatabase> | undefined;
let inbound: ReturnType<typeof startWhatsappInbound> | undefined;
let otp: ReturnType<typeof startStaffOtpWorker> | undefined;
let otpAuth: StaffOtpExecution | undefined;
let capabilityTimer: NodeJS.Timeout | undefined;
let stopping = false;
let maintenance: ReturnType<typeof createStaffOtpMaintenance> | undefined;
const otpConfiguration = () =>
  readStaffOtpConfiguration(process.env, 'worker', readOtpTemplateApproval(process.env));
const KNOWN_EVENT_TYPES = [
  // PR21 بلا مستهلك أعمال في هذه المرحلة؛ الشاشة تقرأ التاريخ ولا يحتاج الحدث إعادة محاولة.
  'EmployeePasskeyUnbound',
  ...staff.eventTypes,
  // PR 11: لا مستهلك بعد؛ سجل الاستيراد التدقيق والأحداث في نفس المعاملة ولا يحتاج إعادة محاولة (ADR-0034).
  'EmployeeImported',
  'ImportCommitted',
  ...(notifications?.eventTypes ?? []),
  ...(inApp?.eventTypes ?? []),
  'FileUploadRequested',
  'CompanyCreated',
  'BusinessCreated',
  'BranchCreated',
  'BusinessSettingsUpdated',
];
const businessDeliver = createDeliverer(
  app,
  [
    ...(notifications === null
      ? inApp === null
        ? []
        : [inApp.consumer]
      : [notifications.consumer]),
    createStaffDocumentDefaults(systemUuidV7()),
  ],
  logger,
  { knownEventTypes: KNOWN_EVENT_TYPES },
);
let queue: ReturnType<typeof startNotificationQueue> | undefined;
const deliver: typeof businessDeliver = (event) =>
  event.eventType === 'FileUploadRequested'
    ? (files?.deliver(event) ??
      Promise.resolve({ delivered: false, error: 'STORAGE_NOT_CONFIGURED', retryInMs: 60_000 }))
    : staff.deliver(event, queue?.deliver ?? businessDeliver);
const loop = createDispatchLoop({ dispatcher, deliver, logger });

const release = async (): Promise<void> => {
  stopping = true;
  clearInterval(capabilityTimer);
  // ننتظر فحص الملفات الجاري قبل إغلاق اتصال قاعدة البيانات.
  await files?.close();
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
  if (process.env['AUTH_DATABASE_URL']) {
    try {
      const retention = createStaffOtpMaintenance({
        databaseUrl: process.env['AUTH_DATABASE_URL'],
        phoneLockKey,
        onFailure: () =>
          logger.warn(
            { capability: { name: 'STAFF_LOGIN', outcome: 'RETENTION_FAILED' } },
            'staff OTP retention unavailable',
          ),
      });
      maintenance = retention;
      await optionalWithin(() => retention.readiness());
      logger.info(
        { capability: { name: 'STAFF_MAINTENANCE', state: 'READY' } },
        'staff OTP capability',
      );
    } catch {
      logger.warn(
        { capability: { name: 'STAFF_MAINTENANCE', state: 'UNAVAILABLE', reason: 'SETUP_FAILED' } },
        'staff OTP capability',
      );
      maintenance?.stop();
      await closeOptional([() => maintenance?.close()]);
      maintenance = undefined;
    }
  } else {
    logger.info(
      { capability: { name: 'STAFF_MAINTENANCE', state: 'DISABLED' } },
      'staff OTP capability',
    );
  }
  if (notifications !== null) {
    try {
      const transport = startNotificationQueue(
        notifications,
        config.REDIS_URL,
        businessDeliver,
        logger,
      );
      queue = transport;
      await optionalWithin(() => transport.ready());
    } catch {
      logger.warn(
        { capability: { name: 'TENANT_WHATSAPP', state: 'UNAVAILABLE', reason: 'SETUP_FAILED' } },
        'staff OTP capability',
      );
      await closeOptional([() => queue?.close(true)]);
      queue = undefined;
    }
  }
  if (intakeUrl) {
    try {
      readWhatsappWebhookConfiguration(process.env);
      const intakeDatabase = createPlatformWhatsappDatabase({ url: intakeUrl });
      globalDatabase = intakeDatabase;
      await optionalWithin(() => intakeDatabase.ping());
      const intake = startWhatsappInbound(intakeDatabase, config.REDIS_URL, logger);
      inbound = intake;
      await optionalWithin(() => intake.ready());
      logger.info(
        { capability: { name: 'WHATSAPP_INTAKE', state: 'READY' } },
        'staff OTP capability',
      );
    } catch {
      logger.warn(
        { capability: { name: 'WHATSAPP_INTAKE', state: 'UNAVAILABLE', reason: 'SETUP_FAILED' } },
        'staff OTP capability',
      );
      await closeOptional([() => inbound?.close(true), () => globalDatabase?.close(true)]);
      inbound = undefined;
      globalDatabase = undefined;
    }
  } else {
    logger.info(
      {
        capability: {
          name: 'WHATSAPP_INTAKE',
          state: process.env['PLATFORM_NOTIFICATIONS_DATABASE_URL'] ? 'UNAVAILABLE' : 'DISABLED',
          reason: process.env['PLATFORM_NOTIFICATIONS_DATABASE_URL']
            ? 'INVALID_CONFIGURATION'
            : 'NOT_CONFIGURED',
        },
      },
      'staff OTP capability',
    );
  }
  const initialOtp = otpConfiguration();
  if (initialOtp.state === 'READY' && inbound !== undefined) {
    try {
      const identity = createPhoneIdentity(
        process.env['NOTIFICATION_PHONE_HASH_KEY'] ?? '',
        process.env['NOTIFICATION_PHONE_HASH_KEY_ID'] ?? '',
      );
      let wasReady: boolean | undefined;
      let healthy = false;
      const configured = () => {
        const current = otpConfiguration();
        return (
          current.state === 'READY' &&
          current.fingerprint === initialOtp.fingerprint &&
          inbound !== undefined &&
          otpAuth !== undefined &&
          !stopping
        );
      };
      const reportCapability = (ready: boolean) => {
        if (ready !== wasReady)
          logger.info(
            { capability: { name: 'STAFF_LOGIN', state: ready ? 'READY' : 'UNAVAILABLE' } },
            'staff OTP capability',
          );
        wasReady = ready;
        return ready;
      };
      const capability = {
        available: () => reportCapability(healthy && configured()),
        ready: async () => {
          try {
            if (!configured() || inbound === undefined) {
              healthy = false;
              return reportCapability(false);
            }
            const intake = inbound;
            await optionalWithin(async () => {
              await intake.ready();
              await otpAuth?.readiness();
              await redis.ping();
            });
            healthy = configured();
            return reportCapability(healthy);
          } catch {
            healthy = false;
            return reportCapability(false);
          }
        },
      };
      otpAuth = createStaffOtpExecution({
        databaseUrl: process.env['AUTH_DATABASE_URL'] ?? '',
        configuration: otpConfiguration,
        capability,
        strategies: { identify: identity.identify, phoneLockKey },
      });
      if (!(await capability.ready())) throw new Error('OPTIONAL_CAPABILITY_UNAVAILABLE');
      const transport = startStaffOtpWorker({
        env: process.env,
        auth: otpAuth,
        capability,
        redis,
        redisUrl: config.REDIS_URL,
        clock: { now: () => new Date() },
        ids: systemUuidV7(),
        diagnostics: {
          record: (outcome) =>
            logger.info(
              { capability: { name: 'STAFF_LOGIN', outcome } },
              'staff OTP execution outcome',
            ),
        },
      });
      otp = transport;
      await optionalWithin(() => transport.ready());
      const publish = async () => {
        const ready = await capability.ready();
        await optionalWithin(async () => {
          if (ready && configured())
            await redis.set('staff-otp:worker-capability', initialOtp.fingerprint, 'PX', 3000);
          else await redis.del('staff-otp:worker-capability');
        });
        return ready && configured();
      };
      if (!(await publish())) throw new Error('OPTIONAL_CAPABILITY_UNAVAILABLE');
      capabilityTimer = setInterval(() => {
        void publish().catch(() =>
          logger.warn(
            {
              capability: {
                name: 'STAFF_LOGIN',
                state: 'UNAVAILABLE',
                reason: 'PUBLISH_FAILED',
              },
            },
            'staff OTP capability',
          ),
        );
      }, 1000);
    } catch {
      logger.warn(
        { capability: { name: 'STAFF_LOGIN', state: 'UNAVAILABLE', reason: 'SETUP_FAILED' } },
        'staff OTP capability',
      );
      clearInterval(capabilityTimer);
      const failedWorker = otp,
        failedAuth = otpAuth;
      otp = undefined;
      otpAuth = undefined;
      await closeOptional([() => failedWorker?.close(true), () => failedAuth?.close()]);
    }
  }
  logger.info(
    {
      capability: {
        name: 'STAFF_LOGIN',
        state:
          initialOtp.state === 'DISABLED'
            ? 'DISABLED'
            : otp === undefined
              ? 'UNAVAILABLE'
              : 'READY',
      },
    },
    'staff OTP capability',
  );
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
