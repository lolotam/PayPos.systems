import {
  createEmailIdentity,
  createPhoneIdentity,
  phoneLockKey,
  readOtpTemplateApproval,
} from '@pospay/notifications';
import type { Logger } from '@pospay/observability';
import { readStaffOtpConfiguration, type AuthService, type OtpConfiguration } from '@pospay/auth';
import type { IdGenerator, TenantWrappers } from '@pospay/db';
import type { Redis } from 'ioredis';

import {
  createPasswordResetCapability,
  type PasswordResetCapability,
} from './modules/identity/index.ts';

/**
 * تشغيل استرجاع كلمة المرور بالإيميل من جذر التركيب: بيبني بصمة الإيميل من مفاتيح البيئة،
 * وأي نقص في المفتاح بيقفل القدرة بس من غير ما يوقّف الـ API.
 *
 * @param options الأدوات المشتركة من جذر التركيب
 * @param options.env بيئة العملية
 * @param options.redis عميل Redis للـ API
 * @param options.redisUrl عنوان Redis لطابور الإرسال
 * @param options.ids مولّد المعرّفات
 * @param options.service خدمة الهوية
 * @param options.logger المسجّل المشترك
 * @param options.production هل العملية في الإنتاج
 * @param options.trustedProxy قائمة الـ proxy الموثوقة
 * @param options.database مغلفات الشركات لاستعادة الرقم السري للموظفة
 * @returns القدرة، أو null لما الإعداد مش مكتمل
 */
export function startPasswordReset(options: {
  env: NodeJS.ProcessEnv;
  redis: Redis;
  redisUrl: string;
  ids: IdGenerator;
  service: Pick<AuthService, 'hashPassword'>;
  logger: Logger;
  production: boolean;
  trustedProxy: readonly string[];
  database?: TenantWrappers | undefined;
}): PasswordResetCapability | null {
  // بلا proxy موثوق في الإنتاج كل الطلبات بتوصل من عنوان الـ proxy نفسه، فحد IP بيبقى دلو واحدة.
  if (options.production && options.trustedProxy.length === 0) {
    options.logger.info(
      {
        capability: {
          name: 'PASSWORD_RESET_OTP',
          state: 'UNAVAILABLE',
          reason: 'NO_TRUSTED_PROXY',
        },
      },
      'password reset capability',
    );
    return null;
  }
  const rateKey = options.env['NOTIFICATION_EMAIL_HASH_KEY'] ?? '';
  let identity: ReturnType<typeof createEmailIdentity>;
  try {
    identity = createEmailIdentity(rateKey, options.env['NOTIFICATION_EMAIL_HASH_KEY_ID'] ?? '');
  } catch {
    options.logger.info(
      {
        capability: {
          name: 'PASSWORD_RESET_OTP',
          state: 'UNAVAILABLE',
          reason: 'EMAIL_KEYS_MISSING',
        },
      },
      'password reset capability',
    );
    return null;
  }
  const { env, redis, redisUrl, ids, service, logger } = options;
  return createPasswordResetCapability({
    env,
    database: options.database,
    whatsappConfiguration: () => pinResetWhatsapp(env),
    redis,
    redisUrl,
    ids,
    service,
    logger,
    rateKey,
    strategies: {
      // الاسترجاع بالإيميل مالوش تليفون، واستعادة الرقم بالواتساب بتحتاج بصمة الهاتف: لو مفتاحها غايب بتتقفل.
      identify: phoneIdentity(env),
      phoneLockKey,
      identifyEmail: identity.identify,
    },
  });
}

/** بصمة الهاتف من مفاتيح البيئة؛ مفتاح ناقص بيدّي بصمة غير صالحة بدل ما يوقّف الإقلاع. */
function phoneIdentity(env: NodeJS.ProcessEnv) {
  const refused = { hash: new Uint8Array(32), hashKeyId: '', last3: '', valid: false };
  return (phone: string) => {
    try {
      return createPhoneIdentity(
        env['NOTIFICATION_PHONE_HASH_KEY'] ?? '',
        env['NOTIFICATION_PHONE_HASH_KEY_ID'] ?? '',
      ).identify(phone);
    } catch {
      return refused;
    }
  };
}

/**
 * جاهزية الواتساب لاستعادة الرقم السري: اعتماد الموظفين الحي وقالب الاسترجاع المعتمد من Meta.
 * القالب لسه ما اتعتمدش، فالمسار مقفول (503) لحد ما STAFF_PIN_RESET_TEMPLATES_APPROVED تتفعّل.
 */
function pinResetWhatsapp(env: NodeJS.ProcessEnv): OtpConfiguration {
  if (env['STAFF_PIN_RESET_TEMPLATES_APPROVED'] !== 'true')
    return { state: 'DISABLED', reason: 'TEMPLATE_NOT_APPROVED' };
  return readStaffOtpConfiguration(env, 'api', readOtpTemplateApproval(env));
}
