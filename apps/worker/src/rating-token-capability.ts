import { readRatingTokenConfiguration } from '@pospay/auth/rating-token';
import type { Logger } from '@pospay/observability';

/**
 * بيسجل حالة مفاتيح روابط التقييم وبصمتها من غير إنشاء codec أو كشف أي سر.
 *
 * @param env متغيرات بيئة الـ worker وحدها
 * @param logger سجل الـ worker ذو الأحداث المسموحة
 * @returns لا شيء؛ يكتب حدث capability واحداً
 */
export function reportRatingTokenCapability(env: NodeJS.ProcessEnv, logger: Logger): void {
  const configuration = readRatingTokenConfiguration(env);
  logger.info(
    {
      capability: {
        name: 'RATING_TOKENS',
        state: configuration.state,
        ...(configuration.state === 'READY'
          ? { fingerprint: configuration.fingerprint }
          : { reason: configuration.reason }),
      },
    },
    'rating token capability',
  );
}
