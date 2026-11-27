import { createEmailIdentity, phoneLockKey } from '@pospay/notifications';
import type { Logger } from '@pospay/observability';
import type { AuthService } from '@pospay/auth';
import type { IdGenerator } from '@pospay/db';
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
    redis,
    redisUrl,
    ids,
    service,
    logger,
    rateKey,
    strategies: {
      // الاسترجاع بالإيميل مالوش تليفون: الهوية دي مقفولة بدل ما تتبنى على مفتاح غايب.
      identify: () => ({ hash: new Uint8Array(32), hashKeyId: '', last3: '', valid: false }),
      phoneLockKey,
      identifyEmail: identity.identify,
    },
  });
}
