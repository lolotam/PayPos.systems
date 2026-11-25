import {
  createRatingTokenCodecs,
  readRatingTokenConfiguration,
  type RatingTokenSenderCodec,
} from '@pospay/auth/rating-token';
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
  const payload = {
    capability: {
      name: 'RATING_TOKENS',
      state: configuration.state,
      ...(configuration.state === 'READY'
        ? { fingerprint: configuration.fingerprint }
        : { reason: configuration.reason }),
    },
  };
  if (configuration.state === 'UNAVAILABLE') logger.warn(payload, 'rating token capability');
  else logger.info(payload, 'rating token capability');
}

/**
 * يبني مشتق الرابط للإرسال فقط عندما تكون حلقة المفاتيح جاهزة، من غير كشف أي سر أو تسجيله.
 *
 * @param env متغيرات بيئة الـ worker وحدها
 * @returns مشتق الرابط في الذاكرة، أو null لما القدرة مقفولة أو غير صالحة (فيفشل الإرسال مغلقاً)
 */
export function createRatingTokenSender(env: NodeJS.ProcessEnv): RatingTokenSenderCodec | null {
  const configuration = readRatingTokenConfiguration(env);
  return configuration.state === 'READY'
    ? createRatingTokenCodecs(configuration.ring).sender
    : null;
}
