import {
  createStaffOtpExecution,
  createStaffOtpMaintenance,
  readStaffOtpConfiguration,
  type StaffOtpExecution,
} from '@pospay/auth';
import { systemUuidV7 } from '@pospay/ids';
import { createPlatformWhatsappDatabase } from '@pospay/db';
import {
  createPhoneIdentity,
  phoneLockKey,
  readOtpTemplateApproval,
  readWhatsappWebhookConfiguration,
} from '@pospay/notifications';
import type { Logger } from '@pospay/observability';
import type { Redis } from 'ioredis';

import {
  startNotificationQueue,
  startStaffOtpWorker,
  startWhatsappInbound,
} from './modules/notifications/index.ts';
import { closeOptional, optionalWithin } from './shared/optional-capability.ts';

type Maintenance = ReturnType<typeof createStaffOtpMaintenance>;
type NotificationQueue = ReturnType<typeof startNotificationQueue>;
type Inbound = ReturnType<typeof startWhatsappInbound>;
type PlatformDatabase = ReturnType<typeof createPlatformWhatsappDatabase>;
type OtpWorker = ReturnType<typeof startStaffOtpWorker>;
type NotificationModule = Parameters<typeof startNotificationQueue>[0];
type BusinessDeliver = Parameters<typeof startNotificationQueue>[2];
type OtpConfiguration = ReturnType<typeof readStaffOtpConfiguration>;

export interface OptionalCapabilities {
  maintenance: Maintenance | undefined;
  queue: NotificationQueue | undefined;
  inbound: Inbound | undefined;
  database: PlatformDatabase | undefined;
  otp: OtpWorker | undefined;
  auth: StaffOtpExecution | undefined;
  timer: NodeJS.Timeout | undefined;
}

interface StaffLoginState {
  otp: OtpWorker | undefined;
  auth: StaffOtpExecution | undefined;
  timer: NodeJS.Timeout | undefined;
}

interface CapabilityInput {
  env: NodeJS.ProcessEnv;
  logger: Logger;
  notifications: NotificationModule | null;
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
    input.notifications === null
      ? undefined
      : await startTenantNotificationQueue(input.notifications, input);
  const intake = await startWhatsappIntake(input);
  const login = await startStaffLogin(input, intake.inbound);
  return {
    maintenance,
    queue,
    inbound: intake.inbound,
    database: intake.database,
    otp: login?.otp,
    auth: login?.auth,
    timer: login?.timer,
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

function staffLoginCapability(input: {
  fingerprint: string;
  inbound: Inbound;
  auth: () => StaffOtpExecution | undefined;
  stopping: () => boolean;
  redis: Redis;
  logger: Logger;
  configuration: () => OtpConfiguration;
}) {
  let wasReady: boolean | undefined;
  let healthy = false;
  const configured = () => {
    const current = input.configuration();
    return (
      current.state === 'READY' &&
      current.fingerprint === input.fingerprint &&
      input.auth() !== undefined &&
      !input.stopping()
    );
  };
  const report = (ready: boolean) => {
    if (ready !== wasReady)
      input.logger.info(
        { capability: { name: 'STAFF_LOGIN', state: ready ? 'READY' : 'UNAVAILABLE' } },
        'staff OTP capability',
      );
    wasReady = ready;
    return ready;
  };
  return {
    configured,
    available: () => report(healthy && configured()),
    ready: async () => {
      try {
        if (!configured()) {
          healthy = false;
          return report(false);
        }
        await optionalWithin(async () => {
          await input.inbound.ready();
          await input.auth()?.readiness();
          await input.redis.ping();
        });
        healthy = configured();
        return report(healthy);
      } catch {
        healthy = false;
        return report(false);
      }
    },
  };
}

function publishStaffCapability(
  redis: Redis,
  fingerprint: string,
  capability: { ready: () => Promise<boolean>; configured: () => boolean },
) {
  return async () => {
    const ready = await capability.ready();
    await optionalWithin(async () => {
      if (ready && capability.configured())
        await redis.set('staff-otp:worker-capability', fingerprint, 'PX', 3000);
      else await redis.del('staff-otp:worker-capability');
    });
    return ready && capability.configured();
  };
}

function watchStaffCapability(publish: () => Promise<boolean>, logger: Logger) {
  return setInterval(() => {
    void publish().catch(() =>
      logger.warn(
        {
          capability: { name: 'STAFF_LOGIN', state: 'UNAVAILABLE', reason: 'PUBLISH_FAILED' },
        },
        'staff OTP capability',
      ),
    );
  }, 1000);
}

async function openStaffLogin(
  input: Pick<CapabilityInput, 'env' | 'redis' | 'redisUrl' | 'logger'> & {
    fingerprint: string;
    configuration: () => OtpConfiguration;
    capability: ReturnType<typeof staffLoginCapability>;
  },
  started: StaffLoginState,
): Promise<void> {
  const identity = createPhoneIdentity(
    input.env['NOTIFICATION_PHONE_HASH_KEY'] ?? '',
    input.env['NOTIFICATION_PHONE_HASH_KEY_ID'] ?? '',
  );
  const auth = createStaffOtpExecution({
    databaseUrl: input.env['AUTH_DATABASE_URL'] ?? '',
    configuration: input.configuration,
    capability: input.capability,
    strategies: { identify: identity.identify, phoneLockKey },
  });
  started.auth = auth;
  if (!(await input.capability.ready())) throw new Error('OPTIONAL_CAPABILITY_UNAVAILABLE');
  const otp = startStaffOtpWorker({
    env: input.env,
    auth,
    capability: input.capability,
    redis: input.redis,
    redisUrl: input.redisUrl,
    clock: { now: () => new Date() },
    ids: systemUuidV7(),
    diagnostics: {
      record: (outcome) =>
        input.logger.info(
          { capability: { name: 'STAFF_LOGIN', outcome } },
          'staff OTP execution outcome',
        ),
    },
  });
  started.otp = otp;
  await optionalWithin(() => otp.ready());
  const publish = publishStaffCapability(input.redis, input.fingerprint, input.capability);
  if (!(await publish())) throw new Error('OPTIONAL_CAPABILITY_UNAVAILABLE');
  started.timer = watchStaffCapability(publish, input.logger);
}

async function abandonStaffLogin(started: StaffLoginState, logger: Logger): Promise<void> {
  logger.warn(
    { capability: { name: 'STAFF_LOGIN', state: 'UNAVAILABLE', reason: 'SETUP_FAILED' } },
    'staff OTP capability',
  );
  clearInterval(started.timer);
  const failedWorker = started.otp;
  const failedAuth = started.auth;
  started.otp = undefined;
  started.auth = undefined;
  started.timer = undefined;
  await closeOptional([() => failedWorker?.close(true), () => failedAuth?.close()]);
}

async function startStaffLogin(
  input: CapabilityInput,
  inbound: Inbound | undefined,
): Promise<StaffLoginState | undefined> {
  const configuration = () =>
    readStaffOtpConfiguration(input.env, 'worker', readOtpTemplateApproval(input.env));
  const initial = configuration();
  const started: StaffLoginState = { otp: undefined, auth: undefined, timer: undefined };
  if (initial.state === 'READY' && inbound !== undefined) {
    const capability = staffLoginCapability({
      fingerprint: initial.fingerprint,
      inbound,
      auth: () => started.auth,
      stopping: input.stopping,
      redis: input.redis,
      logger: input.logger,
      configuration,
    });
    try {
      await openStaffLogin(
        { ...input, fingerprint: initial.fingerprint, configuration, capability },
        started,
      );
    } catch {
      await abandonStaffLogin(started, input.logger);
    }
  }
  input.logger.info(
    {
      capability: {
        name: 'STAFF_LOGIN',
        state:
          initial.state === 'DISABLED'
            ? 'DISABLED'
            : started.otp === undefined
              ? 'UNAVAILABLE'
              : 'READY',
      },
    },
    'staff OTP capability',
  );
  return started.otp === undefined ? undefined : started;
}
