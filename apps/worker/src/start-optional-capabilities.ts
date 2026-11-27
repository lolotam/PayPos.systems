import { createStaffOtpMaintenance, type StaffOtpExecution } from '@pospay/auth';
import { createPlatformWhatsappDatabase } from '@pospay/db';
import { phoneLockKey, readWhatsappWebhookConfiguration } from '@pospay/notifications';
import type { Logger } from '@pospay/observability';
import type { Redis } from 'ioredis';

import { startNotificationQueue, startWhatsappInbound } from './modules/notifications/index.ts';
import type { Inbound } from './modules/notifications/index.ts';
import type { OtpDelivery, OtpWorker } from './otp-delivery.ts';
import { retryDelayMs } from './outbox/retry-policy.ts';
import { closeOptional, optionalWithin } from './shared/optional-capability.ts';

type Maintenance = ReturnType<typeof createStaffOtpMaintenance>;
type NotificationQueue = ReturnType<typeof startNotificationQueue>;
type NotificationSendModule = Parameters<typeof startNotificationQueue>[0];
type PlatformDatabase = ReturnType<typeof createPlatformWhatsappDatabase>;
type NotificationModule = Parameters<typeof startNotificationQueue>[0];
type BusinessDeliver = Parameters<typeof startNotificationQueue>[2];

export interface OptionalCapabilities {
  maintenance: Maintenance | undefined;
  queue: NotificationQueue | undefined;
  inbound: Inbound | undefined;
  database: PlatformDatabase | undefined;
  otp: OtpWorker | undefined;
  auth: StaffOtpExecution | undefined;
  timer: NodeJS.Timeout | undefined;
}

interface CapabilityInput {
  env: NodeJS.ProcessEnv;
  logger: Logger;
  notifications: NotificationModule | null;
  /** مسار إرسال البريد وحده: الإنتاج وواتساب مقفولة والبريد مفعّل. */
  emailSend?: NotificationSendModule | undefined;
  /** قدر إرسال الاعتماد — الجذر بيملكه عشان مصالحة البريد تشوف واجهة الهوية نفسها. */
  delivery: OtpDelivery;
  redisUrl: string;
  businessDeliver: BusinessDeliver;
  intakeUrl: string | undefined;
  redis: Redis;
  stopping: () => boolean;
}

export async function startOptionalCapabilities(
  input: CapabilityInput,
): Promise<OptionalCapabilities> {
  const maintenance = await startStaffMaintenance(input.env, input.logger);
  const queue =
    input.notifications !== null
      ? await startTenantNotificationQueue(input.notifications, input)
      : input.emailSend === undefined
        ? undefined
        : await startEmailNotificationQueue(input.emailSend, input);
  const intake = await startWhatsappIntake(input);
  const delivery = await input.delivery.start(intake.inbound);
  return {
    maintenance,
    queue,
    inbound: intake.inbound,
    database: intake.database,
    otp: delivery.otp,
    auth: input.delivery.auth,
    timer: delivery.timer,
  };
}

async function startStaffMaintenance(env: NodeJS.ProcessEnv, logger: Logger) {
  if (!env['AUTH_DATABASE_URL']) {
    logger.info(
      { capability: { name: 'STAFF_MAINTENANCE', state: 'DISABLED' } },
      'staff OTP capability',
    );
    return undefined;
  }
  let maintenance: Maintenance | undefined;
  try {
    const retention = createStaffOtpMaintenance({
      databaseUrl: env['AUTH_DATABASE_URL'],
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
    return retention;
  } catch {
    logger.warn(
      { capability: { name: 'STAFF_MAINTENANCE', state: 'UNAVAILABLE', reason: 'SETUP_FAILED' } },
      'staff OTP capability',
    );
    maintenance?.stop();
    await closeOptional([() => maintenance?.close()]);
    return undefined;
  }
}

async function startTenantNotificationQueue(
  notifications: NotificationModule,
  input: Pick<CapabilityInput, 'redisUrl' | 'businessDeliver' | 'logger'>,
) {
  let queue: NotificationQueue | undefined;
  try {
    const transport = startNotificationQueue(
      notifications,
      input.redisUrl,
      input.businessDeliver,
      input.logger,
    );
    queue = transport;
    await optionalWithin(() => transport.ready());
    return transport;
  } catch {
    input.logger.warn(
      { capability: { name: 'TENANT_WHATSAPP', state: 'UNAVAILABLE', reason: 'SETUP_FAILED' } },
      'staff OTP capability',
    );
    await closeOptional([() => queue?.close(true)]);
    return undefined;
  }
}

async function startEmailNotificationQueue(
  module: NotificationSendModule,
  input: Pick<CapabilityInput, 'redisUrl' | 'businessDeliver' | 'logger'>,
): Promise<NotificationQueue> {
  let queue: NotificationQueue | undefined;
  try {
    const transport = startNotificationQueue(
      module,
      input.redisUrl,
      input.businessDeliver,
      input.logger,
    );
    queue = transport;
    await optionalWithin(() => transport.ready());
    return transport;
  } catch {
    input.logger.warn(
      { capability: { name: 'EMAIL_SEND', state: 'UNAVAILABLE', reason: 'SETUP_FAILED' } },
      'email capability',
    );
    await closeOptional([() => queue?.close(true)]);
    return {
      deliver: async (event) =>
        event.eventType === 'NotificationSendAuthorized'
          ? {
              delivered: false,
              error: 'NOTIFICATION_QUEUE_UNAVAILABLE',
              retryInMs: retryDelayMs(event.attempt),
            }
          : input.businessDeliver(event),
      ready: async () => undefined,
      stop: async () => undefined,
      close: async () => undefined,
    };
  }
}

async function startWhatsappIntake(
  input: Pick<CapabilityInput, 'env' | 'intakeUrl' | 'redisUrl' | 'logger'>,
): Promise<{ inbound: Inbound | undefined; database: PlatformDatabase | undefined }> {
  if (!input.intakeUrl) {
    const configured = input.env['PLATFORM_NOTIFICATIONS_DATABASE_URL'];
    input.logger.info(
      {
        capability: {
          name: 'WHATSAPP_INTAKE',
          state: configured ? 'UNAVAILABLE' : 'DISABLED',
          reason: configured ? 'INVALID_CONFIGURATION' : 'NOT_CONFIGURED',
        },
      },
      'staff OTP capability',
    );
    return { inbound: undefined, database: undefined };
  }
  let inbound: Inbound | undefined;
  let database: PlatformDatabase | undefined;
  try {
    readWhatsappWebhookConfiguration(input.env);
    const intakeDatabase = createPlatformWhatsappDatabase({ url: input.intakeUrl });
    database = intakeDatabase;
    await optionalWithin(() => intakeDatabase.ping());
    const intake = startWhatsappInbound(intakeDatabase, input.redisUrl, input.logger);
    inbound = intake;
    await optionalWithin(() => intake.ready());
    input.logger.info(
      { capability: { name: 'WHATSAPP_INTAKE', state: 'READY' } },
      'staff OTP capability',
    );
    return { inbound, database };
  } catch {
    input.logger.warn(
      { capability: { name: 'WHATSAPP_INTAKE', state: 'UNAVAILABLE', reason: 'SETUP_FAILED' } },
      'staff OTP capability',
    );
    await closeOptional([() => inbound?.close(true), () => database?.close(true)]);
    return { inbound: undefined, database: undefined };
  }
}
