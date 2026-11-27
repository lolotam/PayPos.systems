import type { Provider } from '@nestjs/common';
import {
  createPasswordResetOtpApi,
  readEmailOtpConfiguration,
  type AuthService,
  type EmailOtpStrategies,
  type OtpCapability,
  type PasswordResetOtpApi,
} from '@pospay/auth';
import type { IdGenerator } from '@pospay/db';
import type { Logger } from '@pospay/observability';
import type { Redis } from 'ioredis';
import { optionalWithin } from '../../shared/optional-capability.ts';
import {
  PASSWORD_RESET_ORIGINS,
  PASSWORD_RESET_OTP_API,
} from './http/password-reset-otp.controller.ts';
import { createOtpSender } from './persistence/bullmq-otp-sender.ts';
import { redisOtpRates } from './persistence/redis-otp-rates.ts';

/** قدرة استرجاع كلمة المرور بالإيميل: الخدمة، وإغلاق موارد النقل. */
export interface PasswordResetCapability {
  readonly api: PasswordResetOtpApi;
  close(): Promise<void>;
}

/**
 * ربط استرجاع كلمة المرور بالإيميل: الخدمة والأصول الموثوقة. من غير الخدمة المسار بيرد 503.
 *
 * @param api خدمة الاسترجاع، أو null لو قناة الإيميل مش جاهزة
 * @param origins أصول المتصفح الموثوقة
 * @returns مزوّدات المسار
 */
export function passwordResetProviders(
  api: PasswordResetOtpApi | null,
  origins: readonly string[],
): Provider[] {
  return [
    { provide: PASSWORD_RESET_OTP_API, useValue: api },
    { provide: PASSWORD_RESET_ORIGINS, useValue: origins },
  ];
}

/**
 * جاهزية قناة الإيميل: الإعداد مكتمل وبصمة العامل المنشورة في Redis هي بصمة الـ API نفسها —
 * عامل بمفاتيح مختلفة مايستلمش كود ما يقدر يتحقق منه. مستقلة عن جاهزية الواتساب.
 */
function emailCapability(
  configuration: () => ReturnType<typeof readEmailOtpConfiguration>,
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
          return (await transport.workerFingerprint(deadline, 'EMAIL')) === current.fingerprint;
        });
      } catch {
        return false;
      }
    },
  };
}

const waitUntil = (deadline: Date): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, deadline.getTime() - Date.now())));

/**
 * يبني قدرة استرجاع كلمة المرور بالإيميل من جذر التركيب. مستقلة تماماً عن الواتساب (BR-004):
 * بتشتغل لما الإيميل جاهز ومفاتيح الرمز موجودة، حتى لو اعتماد الموظفين مقفول.
 *
 * @param options الأدوات المشتركة من جذر التركيب
 * @param options.env بيئة العملية
 * @param options.redis عميل Redis للـ API
 * @param options.redisUrl عنوان Redis لطابور الإرسال
 * @param options.ids مولّد المعرّفات
 * @param options.service خدمة الهوية — هي الوحيدة اللي بتحسب hash كلمة المرور
 * @param options.strategies بصمة الإيميل ومفتاح قفل الهاتف
 * @param options.rateKey مفتاح HMAC لحدود Redis
 * @param options.logger المسجّل المشترك — بيسجّل حالة القدرة ونتيجة التحضير من غير أي إيميل أو كود
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
}): PasswordResetCapability | null {
  const { env, redis, redisUrl, ids, service, strategies, rateKey, logger } = options;
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
  const api: PasswordResetOtpApi = createPasswordResetOtpApi({
    databaseUrl: env['AUTH_DATABASE_URL'] ?? '',
    configuration,
    strategies,
    rates: redisOtpRates(redis, rateKey, ids),
    sender: transport.sender,
    ids,
    hasher: { hash: (password) => service.hashPassword(password) },
    clock: { now: () => new Date(), waitUntil },
    capability: emailCapability(configuration, transport, () => api.readiness()),
    onOutcome: (result) =>
      logger.info({ capability: { name, result } }, 'password reset preparation outcome'),
  });
  logger.info({ capability: { name, state: 'READY' } }, 'password reset capability');
  return {
    api,
    close: async () => {
      await Promise.allSettled([api.close(), transport.close(true)]);
    },
  };
}
