import type { Provider } from '@nestjs/common';
import {
  createPasswordResetOtpApi,
  createStaffPinResetApi,
  readEmailOtpConfiguration,
  type AuthService,
  type EmailOtpStrategies,
  type OtpCapability,
  type OtpConfiguration,
  type PasswordResetOtpApi,
  type StaffPinResetApi,
} from '@pospay/auth';
import type { IdGenerator, TenantWrappers } from '@pospay/db';
import type { Logger } from '@pospay/observability';
import type { Redis } from 'ioredis';
import { systemClock } from '../../shared/adapters/system-clock.ts';
import { optionalWithin } from '../../shared/optional-capability.ts';
import {
  PASSWORD_RESET_ORIGINS,
  PASSWORD_RESET_OTP_API,
} from './http/password-reset-otp.controller.ts';
import { STAFF_PIN_RESET_API, STAFF_PIN_RESET_ENABLED } from './http/staff-pin-reset.controller.ts';
import { authPinHasher } from './persistence/auth-pin-hasher.ts';
import { createOtpSender } from './persistence/bullmq-otp-sender.ts';
import { redisOtpRates } from './persistence/redis-otp-rates.ts';
import { createRedisPinAttempts } from './persistence/redis-pin-attempts.ts';
import { createStaffEligibility } from './persistence/staff-eligibility.ts';
import { createStaffPinTransactions } from './persistence/staff-pin-transactions.ts';
import { createStaffRecoveryReader } from './persistence/staff-recovery-reader.ts';
import { RecoverStaffPin } from './use-cases/recover-staff-pin/recover-staff-pin.ts';

/** قدرة استرجاع كلمة المرور بالإيميل: الخدمة، وإغلاق موارد النقل. */
export interface PasswordResetCapability {
  readonly api: PasswordResetOtpApi;
  /** استعادة الموظفة رقمها السري: بتتبني على نفس الإيميل والطابور، وnull من غير قاعدة بيانات الشركات. */
  readonly pinReset: StaffPinResetApi | null;
  close(): Promise<void>;
}

/**
 * ربط استرجاع كلمة المرور بالإيميل: الخدمة والأصول الموثوقة. من غير الخدمة المسار بيرد 503.
 *
 * @param api خدمة الاسترجاع، أو null لو قناة الإيميل مش جاهزة
 * @param origins أصول المتصفح الموثوقة
 * @param pinReset خدمة استعادة الرقم السري للموظفة وبوابتها (spec 079 PR-c1)
 * @returns مزوّدات المسار
 */
export function passwordResetProviders(
  api: PasswordResetOtpApi | null,
  origins: readonly string[],
  pinReset: { api: StaffPinResetApi | null; enabled: boolean } = { api: null, enabled: false },
): Provider[] {
  return [
    { provide: PASSWORD_RESET_OTP_API, useValue: api },
    { provide: PASSWORD_RESET_ORIGINS, useValue: origins },
    { provide: STAFF_PIN_RESET_API, useValue: pinReset.api },
    { provide: STAFF_PIN_RESET_ENABLED, useValue: pinReset.enabled },
  ];
}

/** جاهزية قناة: إعدادها مكتمل وبصمة العامل المنشورة في Redis هي بصمة الـ API نفسها. */
function channelCapability(
  channel: 'EMAIL' | 'WHATSAPP',
  configuration: () => { state: string; fingerprint?: string },
  transport: ReturnType<typeof createOtpSender>,
  probe: () => Promise<void>,
): OtpCapability {
  return {
    ready: async (deadline) => {
      const current = configuration();
      if (current.state !== 'READY') return false;
      try {
        return await optionalWithin(async () => {
          if (deadline === undefined) {
            await probe();
            await transport.ready();
          }
          return (await transport.workerFingerprint(deadline, channel)) === current.fingerprint;
        });
      } catch {
        return false;
      }
    },
  };
}

const waitUntil = (deadline: Date): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, deadline.getTime() - Date.now())));

/** استعادة الرقم السري: بتتفعّل بس لما قاعدة بيانات الشركات موجودة، والواتساب فيها مستقل عن الإيميل. */
function pinResetApi(options: {
  env: NodeJS.ProcessEnv;
  database: TenantWrappers;
  redis: Redis;
  ids: IdGenerator;
  strategies: EmailOtpStrategies;
  rateKey: string;
  transport: ReturnType<typeof createOtpSender>;
  whatsappConfiguration: () => OtpConfiguration;
  logger: Logger;
}): StaffPinResetApi {
  const { env, database, redis, ids, transport } = options;
  const config = options.whatsappConfiguration;
  const api: StaffPinResetApi = createStaffPinResetApi({
    databaseUrl: env['AUTH_DATABASE_URL'] ?? '',
    emailConfiguration: () => readEmailOtpConfiguration(env),
    whatsappConfiguration: config,
    capability: {
      EMAIL: channelCapability(
        'EMAIL',
        () => readEmailOtpConfiguration(env),
        transport,
        () => api.readiness(),
      ),
      WHATSAPP: channelCapability(
        'WHATSAPP',
        () => {
          const current = config();
          return current.state === 'READY'
            ? { state: 'READY', fingerprint: current.fingerprint }
            : { state: current.state };
        },
        transport,
        () => api.readiness(),
      ),
    },
    rates: redisOtpRates(redis, options.rateKey, ids, 'staff-pin-reset-otp'),
    sender: transport.sender,
    strategies: options.strategies,
    eligibility: createStaffEligibility(database),
    recovery: createStaffRecoveryReader(database),
    pins: new RecoverStaffPin(
      createStaffPinTransactions(database, ids),
      authPinHasher,
      createRedisPinAttempts(redis, ids),
      systemClock,
    ),
    ids,
    clock: { now: () => new Date(), waitUntil },
    onOutcome: (result) =>
      options.logger.info(
        { capability: { name: 'STAFF_PIN_RESET_OTP', result } },
        'staff pin reset preparation outcome',
      ),
  });
  return api;
}

/** خدمة استرجاع كلمة المرور بالإيميل على الطابور والمفاتيح المشتركة. */
function passwordResetApi(
  options: {
    env: NodeJS.ProcessEnv;
    redis: Redis;
    ids: IdGenerator;
    service: Pick<AuthService, 'hashPassword'>;
    strategies: EmailOtpStrategies;
    rateKey: string;
    logger: Logger;
  },
  configuration: () => ReturnType<typeof readEmailOtpConfiguration>,
  transport: ReturnType<typeof createOtpSender>,
): PasswordResetOtpApi {
  const { env, redis, ids, service, strategies, rateKey, logger } = options;
  const api: PasswordResetOtpApi = createPasswordResetOtpApi({
    databaseUrl: env['AUTH_DATABASE_URL'] ?? '',
    configuration,
    strategies,
    rates: redisOtpRates(redis, rateKey, ids, 'password-reset-otp'),
    sender: transport.sender,
    ids,
    hasher: { hash: (password) => service.hashPassword(password) },
    clock: { now: () => new Date(), waitUntil },
    capability: channelCapability('EMAIL', configuration, transport, () => api.readiness()),
    onOutcome: (result) =>
      logger.info(
        { capability: { name: 'PASSWORD_RESET_OTP', result } },
        'password reset preparation outcome',
      ),
  });
  return api;
}

/**
 * يبني قدرة استرجاع كلمة المرور بالإيميل من جذر التركيب. مستقلة تماماً عن الواتساب (BR-004):
 * بتشتغل لما الإيميل جاهز ومفاتيح الرمز موجودة، حتى لو اعتماد الموظفين مقفول. ومعاها استعادة
 * الموظفة رقمها السري بنفس الطابور والمفاتيح لما قاعدة بيانات الشركات موجودة.
 *
 * @param options الأدوات المشتركة من جذر التركيب
 * @param options.env بيئة العملية
 * @param options.redis عميل Redis للـ API
 * @param options.redisUrl عنوان Redis لطابور الإرسال
 * @param options.ids مولّد المعرّفات
 * @param options.service خدمة الهوية — هي الوحيدة اللي بتحسب hash كلمة المرور
 * @param options.strategies بصمة الإيميل والهاتف ومفتاح قفل الهاتف
 * @param options.rateKey مفتاح HMAC لحدود Redis
 * @param options.logger المسجّل المشترك — بيسجّل حالة القدرة ونتيجة التحضير من غير أي إيميل أو كود
 * @param options.database مغلفات الشركات لاستعادة الرقم السري، أو غيابها
 * @param options.whatsappConfiguration جاهزية الواتساب لاستعادة الرقم: مقفولة حتى اعتماد القالب
 * @returns القدرة، أو null لو الإعداد مش مكتمل
 */
export function createPasswordResetCapability(options: {
  env: NodeJS.ProcessEnv;
  redis: Redis;
  redisUrl: string;
  ids: IdGenerator;
  service: Pick<AuthService, 'hashPassword'>;
  /** بصمة الإيميل ومفتاح قفل الهاتف من جذر التركيب — الهوية ما بتستوردش الإشعارات. */
  strategies: EmailOtpStrategies;
  /** مفتاح HMAC بتاع حدود Redis: نفس مفتاح بصمة الإيميل. */
  rateKey: string;
  logger: Logger;
  database?: TenantWrappers | undefined;
  whatsappConfiguration?: () => OtpConfiguration;
}): PasswordResetCapability | null {
  const { env, redis, redisUrl, ids, strategies, rateKey, logger } = options;
  const configuration = () => readEmailOtpConfiguration(env);
  const initial = configuration();
  const name = 'PASSWORD_RESET_OTP';
  if (initial.state !== 'READY') {
    logger.info(
      { capability: { name, state: initial.state, reason: initial.reason } },
      'password reset capability',
    );
    return null;
  }
  const transport = createOtpSender(redisUrl);
  const api = passwordResetApi(options, configuration, transport);
  const pinReset =
    options.database === undefined
      ? null
      : pinResetApi({
          env,
          database: options.database,
          redis,
          ids,
          strategies,
          rateKey,
          transport,
          whatsappConfiguration:
            options.whatsappConfiguration ??
            (() => ({ state: 'DISABLED', reason: 'NOT_ACTIVATED' })),
          logger,
        });
  logger.info({ capability: { name, state: 'READY' } }, 'password reset capability');
  return {
    api,
    pinReset,
    close: async () => {
      await Promise.allSettled([api.close(), pinReset?.close(), transport.close(true)]);
    },
  };
}
