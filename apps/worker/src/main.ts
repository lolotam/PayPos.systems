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
} from './modules/notifications/index.ts';
import { createDispatchLoop } from './outbox/dispatch-loop.ts';
import { readConfig } from './shared/config.ts';
import { WORKER_LOG_EVENTS } from './shared/log-events.ts';
import { createWorker } from './worker.ts';

const config = readConfig(process.env);
const logger = createLogger(config.LOG_LEVEL, { events: WORKER_LOG_EVENTS });

const app = createDatabase({ url: config.DATABASE_URL, ids: systemUuidV7() });
const dispatcher = createOutboxDispatcherDatabase({ url: config.DISPATCHER_DATABASE_URL });
const redis = new Redis(config.REDIS_URL, { enableOfflineQueue: false, maxRetriesPerRequest: 1 });
// Attached before any connection event, so ioredis never prints raw errors outside the logger.
redis.on('error', (error: unknown) => {
  logger.warn({ err: error }, 'redis connection error');
});

// ADR-0019: استقبال STOP وin-app مستقلان؛ تفعيل OTP لا يفتح إرسال الشركات.
const production = process.env['NODE_ENV'] === 'production';
const notifications = production
  ? null
  : createNotificationModule({
      database: app,
      ids: systemUuidV7(),
      clock: { now: () => new Date() },
      configuration: readNotificationConfiguration(process.env),
      production,
    });
const inApp = production
  ? createInAppNotificationModule({
      database: app,
      ids: systemUuidV7(),
      clock: { now: () => new Date() },
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
const maintenance = process.env['AUTH_DATABASE_URL']
  ? createStaffOtpMaintenance({
      databaseUrl: process.env['AUTH_DATABASE_URL'],
      phoneLockKey,
      onFailure: () =>
        logger.warn(
          { capability: { name: 'STAFF_LOGIN', outcome: 'RETENTION_FAILED' } },
          'staff OTP retention unavailable',
        ),
    })
  : undefined;
const otpConfiguration = () =>
  readStaffOtpConfiguration(process.env, 'worker', readOtpTemplateApproval(process.env));
const KNOWN_EVENT_TYPES = [
  ...(notifications?.eventTypes ?? []),
  ...(inApp?.eventTypes ?? []),
  'CompanyCreated',
  'BusinessCreated',
  'BranchCreated',
  'BusinessSettingsUpdated',
];
const businessDeliver = createDeliverer(
  app,
  notifications === null ? (inApp === null ? [] : [inApp.consumer]) : [notifications.consumer],
  logger,
  { knownEventTypes: KNOWN_EVENT_TYPES },
);
const queue =
  notifications === null
    ? null
    : startNotificationQueue(notifications, config.REDIS_URL, businessDeliver, logger);
const deliver = queue?.deliver ?? businessDeliver;
const loop = createDispatchLoop({ dispatcher, deliver, logger });

const release = async (): Promise<void> => {
  clearInterval(capabilityTimer);
  await Promise.allSettled([
    inbound?.close(),
    otp?.close(),
    otpAuth?.close(),
    maintenance?.close(),
    globalDatabase?.close(),
    queue?.close(),
    dispatcher.close(),
    app.close(),
    redis.quit(),
  ]);
  redis.disconnect();
};

try {
  if (intakeUrl) {
    try {
      readWhatsappWebhookConfiguration(process.env);
      globalDatabase = createPlatformWhatsappDatabase({ url: intakeUrl });
      await globalDatabase.ping();
      inbound = startWhatsappInbound(globalDatabase, config.REDIS_URL, logger);
      await inbound.ready();
      logger.info(
        { capability: { name: 'WHATSAPP_INTAKE', state: 'READY' } },
        'staff OTP capability',
      );
    } catch {
      logger.warn(
        { capability: { name: 'WHATSAPP_INTAKE', state: 'UNAVAILABLE', reason: 'SETUP_FAILED' } },
        'staff OTP capability',
      );
      await inbound?.stop().catch(() => undefined);
      await inbound?.close().catch(() => undefined);
      await globalDatabase?.close().catch(() => undefined);
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
          inbound !== undefined
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
            await inbound.ready();
            await otpAuth?.readiness();
            await redis.ping();
            healthy = true;
            return reportCapability(true);
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
      if (await capability.ready()) {
        otp = startStaffOtpWorker({
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
        await otp.ready();
        const publish = async () => {
          if (await capability.ready())
            await redis.set('staff-otp:worker-capability', initialOtp.fingerprint, 'PX', 3000);
          else await redis.del('staff-otp:worker-capability');
        };
        await publish();
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
      }
    } catch {
      logger.warn(
        { capability: { name: 'STAFF_LOGIN', state: 'UNAVAILABLE', reason: 'SETUP_FAILED' } },
        'staff OTP capability',
      );
      await otp?.close().catch(() => undefined);
      await otpAuth?.close().catch(() => undefined);
      otp = undefined;
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
        ...(queue === null ? [] : [{ name: 'notifications', check: () => queue.ready() }]),
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
        maintenance?.stop();
        await loop.stop();
        await queue?.stop();
        await inbound?.stop();
        clearInterval(capabilityTimer);
        await otp?.stop();
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
  await queue?.stop();
  await inbound?.stop();
  await release();
  process.exit(1);
}
