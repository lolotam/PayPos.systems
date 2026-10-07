import {
  createAuth,
  deriveEmployeeCardKey,
  createStaffOtpApi,
  readStaffOtpConfiguration,
  type AuthService,
  type StaffOtpApi,
  type StaffOtpApiOptions,
  type PersonalSession,
  type PersonalWorkspace,
  passkeyPolicy,
} from '@pospay/auth';
import { createPhoneIdentity, phoneLockKey, readOtpTemplateApproval } from '@pospay/notifications';
import { createDatabase, createPlatformWhatsappDatabase } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import { Redis } from 'ioredis';
import { readEmailConfiguration } from '@pospay/notifications';

import { createApp } from './app.ts';
import { filesRuntime } from './modules/files/index.ts';
import { createWhatsappIntake } from './modules/notifications/index.ts';
import { API_LOG_EVENTS } from './shared/log-events.ts';
import { createActivePasskeyBindings, createPersonalEligibility } from './modules/staff/index.ts';
import { membershipCompanies, staffOtpDependencies } from './modules/identity/index.ts';
import { readConfig } from './shared/config.ts';
import { closeOptional, optionalWithin } from './shared/optional-capability.ts';

const config = readConfig(process.env);
const logger = createLogger(config.LOG_LEVEL, { events: API_LOG_EVENTS });
logger.info(
  { capability: { channel: 'email', enabled: false, reason: readEmailConfiguration({}).reason } },
  'email disabled',
);

// UUID v7 on the system clock and Web Crypto — bound to @pospay/db's IdGenerator here, at the composition root.
const database = createDatabase({
  url: config.DATABASE_URL,
  ids: systemUuidV7(),
  boundedTenantTransactions:
    readStaffOtpConfiguration(process.env, 'api', readOtpTemplateApproval(process.env)).state ===
    'READY',
});
// Built inside the try below: createAuth refuses a pool that is not pospay_auth before anything listens.
let auth: AuthService | undefined;
let otp: StaffOtpApi | undefined;
let personalOtp:
  ReturnType<typeof createStaffOtpApi<PersonalWorkspace, PersonalSession>> | undefined;
let otpDependencies: ReturnType<typeof staffOtpDependencies> | undefined;
let otpInitializing = true;
let otpSetupFailed = false;
const otpConfiguration = () =>
  readStaffOtpConfiguration(process.env, 'api', readOtpTemplateApproval(process.env));
const intakeUrl = config.PLATFORM_NOTIFICATIONS_DATABASE_URL;
let globalDatabase: ReturnType<typeof createPlatformWhatsappDatabase> | undefined;
let whatsapp: ReturnType<typeof createWhatsappIntake> | undefined;

// No offline queue: while Redis is down a command fails at once, so /ready reports it instead of hanging.
const redis = new Redis(config.REDIS_URL, {
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  commandTimeout: 500,
});
// Attached before any connection event: without a listener ioredis prints raw errors to stderr,
// outside the sanitising logger.
redis.on('error', (error: unknown) => {
  logger.warn({ err: error }, 'redis connection error');
});

const RELEASE_DEADLINE_MS = 5_000;
const files = filesRuntime(process.env, redis);

// One bounded cleanup for both startup failure and shutdown: close gracefully, then force the Redis
// socket shut if the deadline passes (the database close has its own 5 s forced end).
const release = async (): Promise<void> => {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, RELEASE_DEADLINE_MS);
  });
  await Promise.race([
    Promise.allSettled([
      whatsapp?.close(true),
      globalDatabase?.close(true),
      database.close(),
      files?.close(),
      auth?.close(),
      otp?.close(),
      personalOtp?.close(),
      otpDependencies?.transport.close(true),
      redis.quit(),
    ]),
    deadline,
  ]);
  clearTimeout(timer);
  redis.disconnect();
};

try {
  if (intakeUrl !== undefined) {
    try {
      if (process.env['NODE_ENV'] === 'production' && config.TRUSTED_PROXY_CIDRS.length === 0)
        throw new Error('WHATSAPP_CAPABILITY_UNAVAILABLE');
      globalDatabase = createPlatformWhatsappDatabase({ url: intakeUrl });
      const intake = createWhatsappIntake(globalDatabase, config.REDIS_URL, process.env, logger);
      whatsapp = intake;
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
      await closeOptional([() => whatsapp?.close(true), () => globalDatabase?.close(true)]);
      whatsapp = undefined;
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
  auth = await createAuth({
    passkeyBindings: createActivePasskeyBindings(database, {
      forUser: (userId) => membershipCompanies(database, userId),
    }),
    databaseUrl: config.AUTH_DATABASE_URL,
    secret: config.BETTER_AUTH_SECRET,
    baseURL: config.BETTER_AUTH_URL,
    trustedOrigins: config.AUTH_TRUSTED_ORIGINS,
    ids: systemUuidV7(),
    staffPhoneLockKey: phoneLockKey,
    secureCookies: config.BETTER_AUTH_URL.startsWith('https:'),
    cookieDomain: config.COOKIE_DOMAIN,
    // Already stripped of error objects and long values inside packages/auth.
    onLog: ({ level, message, errorNames }) => {
      logger[level]({ auth: { message, errorNames } }, 'auth library event');
    },
  });
  const service = auth;
  const initialOtp = otpConfiguration();
  if (initialOtp.state === 'READY' && whatsapp !== undefined) {
    try {
      otpDependencies = staffOtpDependencies({
        database,
        redis,
        ids: systemUuidV7(),
        hashKey: process.env['NOTIFICATION_PHONE_HASH_KEY'] ?? '',
        redisUrl: config.REDIS_URL,
      });
      const dependencies = otpDependencies;
      const identity = createPhoneIdentity(
        process.env['NOTIFICATION_PHONE_HASH_KEY'] ?? '',
        process.env['NOTIFICATION_PHONE_HASH_KEY_ID'] ?? '',
      );
      const otpOptions: StaffOtpApiOptions = {
        concurrency: { active: 0 },
        onCapabilityState: (state) =>
          logger.info({ capability: { name: 'STAFF_LOGIN', state } }, 'staff OTP capability'),
        databaseUrl: config.AUTH_DATABASE_URL,
        configuration: otpConfiguration,
        strategies: { identify: identity.identify, phoneLockKey },
        eligibility: dependencies.eligibility,
        sessions: service.staff,
        rates: dependencies.rates,
        sender: dependencies.transport.sender,
        ids: systemUuidV7(),
        clock: {
          now: () => new Date(),
          waitUntil: (deadline) =>
            new Promise((resolve) =>
              setTimeout(resolve, Math.max(0, deadline.getTime() - Date.now())),
            ),
        },
        capability: {
          ready: async (deadline) => {
            try {
              const current = otpConfiguration();
              if (
                current.state !== 'READY' ||
                whatsapp === undefined ||
                globalDatabase === undefined
              )
                return false;
              const intake = whatsapp;
              return await optionalWithin(async () => {
                if (deadline !== undefined)
                  return (
                    (await dependencies.transport.workerFingerprint(deadline)) ===
                    current.fingerprint
                  );
                await database.ping();
                await intake.ready();
                await dependencies.transport.ready();
                await otp?.readiness();
                return (await dependencies.transport.workerFingerprint()) === current.fingerprint;
              });
            } catch {
              if (otpInitializing) otpSetupFailed = true;
              return false;
            }
          },
        },
        audit: async (action, userId, device, challengeId) =>
          service.recordPlatformAction({
            actor: userId ?? 'staff',
            action,
            targetUserId: userId,
            details: {
              deviceId: device.deviceId,
              ...(challengeId === undefined ? {} : { challengeId }),
            },
          }),
        onOutcome: (result) =>
          logger.info(
            { capability: { name: 'STAFF_LOGIN', result } },
            'staff OTP preparation outcome',
          ),
        onFailure: (phase, failure) =>
          logger.warn(
            { capability: { name: 'STAFF_LOGIN', phase, failure } },
            'staff OTP preparation outcome',
          ),
      };
      otp = createStaffOtpApi(otpOptions);
      personalOtp = createStaffOtpApi<PersonalWorkspace, PersonalSession>({
        ...otpOptions,
        sessions: service.personal,
        eligibility: createPersonalEligibility(database),
        audit: (action, userId) =>
          service.recordPlatformAction({
            actor: userId ?? 'staff',
            action: action.replace('staff.', 'staff.personal_'),
            targetUserId: userId,
            details: {},
          }),
      });
    } catch {
      logger.warn(
        { capability: { name: 'STAFF_LOGIN', state: 'UNAVAILABLE', reason: 'SETUP_FAILED' } },
        'staff OTP capability',
      );
      await closeOptional([
        () => otpDependencies?.transport.close(true),
        () => otp?.close(),
        () => personalOtp?.close(),
      ]);
      otp = undefined;
      personalOtp = undefined;
    }
  }
  const otpState =
    initialOtp.state === 'DISABLED'
      ? 'DISABLED'
      : await optionalWithin(async () => (await otp?.state()) ?? 'UNAVAILABLE').catch(() => {
          otpSetupFailed = true;
          return 'UNAVAILABLE';
        });
  otpInitializing = false;
  if (otpSetupFailed) {
    logger.warn(
      { capability: { name: 'STAFF_LOGIN', state: 'UNAVAILABLE', reason: 'SETUP_FAILED' } },
      'staff OTP capability',
    );
    await closeOptional([
      () => otpDependencies?.transport.close(true),
      () => otp?.close(),
      () => personalOtp?.close(),
    ]);
    otp = undefined;
    personalOtp = undefined;
  }
  logger.info(
    {
      capability: {
        name: 'STAFF_LOGIN',
        state: otpState,
      },
    },
    'staff OTP capability',
  );
  const app = await createApp(
    {
      readiness: [
        { name: 'database', check: () => database.ping() },
        { name: 'auth', check: () => service.ping() },
        {
          name: 'redis',
          check: async () => {
            await redis.ping();
          },
        },
      ],
      onShutdown: release,
      auth: { service, baseURL: config.BETTER_AUTH_URL },
      employeeCardKey: deriveEmployeeCardKey(config.BETTER_AUTH_SECRET),
      personal: {
        sessions: service.personal,
        otp: personalOtp ?? null,
        origin: passkeyPolicy(
          config.BETTER_AUTH_URL,
          config.AUTH_TRUSTED_ORIGINS,
          process.env['STAFF_OTP_POS_ORIGIN'],
        ).personalOrigin,
        eligibility: createPersonalEligibility(database),
      },
      staff: {
        api: otp ?? null,
        sessions: service.staff,
        origin: process.env['STAFF_OTP_POS_ORIGIN'] || null,
      },
      database,
      files,
      redis,
      corsOrigins: config.AUTH_TRUSTED_ORIGINS,
      ...(whatsapp === undefined ? {} : { whatsapp }),
      trustedProxy: config.TRUSTED_PROXY_CIDRS,
    },
    { logger },
  );
  app.enableShutdownHooks();
  await app.listen({ host: config.API_HOST, port: config.API_PORT });
} catch (error) {
  // Only the sanitised diagnostic is logged — the error's message can carry a connection string.
  logger.fatal({ err: error }, 'api failed to start');
  await release();
  process.exit(1);
}
