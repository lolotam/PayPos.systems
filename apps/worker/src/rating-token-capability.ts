import { createRatingTokenCodecs, readRatingTokenConfiguration } from '@pospay/auth/rating-token';
import type { Logger } from '@pospay/observability';

/**
 * كود اشتقاق البصمة كما تبنيه حزمة auth؛ المفتاح نفسه ما بيوصلش لغير هذا الجذر (ADR-0057 §1).
 */
export interface RatingTokenDeriver {
  /** يشتق بصمة الرابط من هوية الطلب. */
  claim(identity: { companyId: string; ratingRequestId: string }): {
    tokenHash: Uint8Array;
    keyVersion: number;
  };
}

/**
 * يقرأ حلقة المفاتيح ويبني كود اشتقاق البصمة، ويفشل مغلقاً: بلا حلقة لا بصمة ولا مطالبة.
 *
 * @param env متغيرات بيئة الـ worker وحدها
 * @returns كود الاشتقاق، أو null لما القدرة غير جاهزة
 */
export function readRatingTokenDeriver(env: NodeJS.ProcessEnv): RatingTokenDeriver | null {
  const configuration = readRatingTokenConfiguration(env);
  if (configuration.state !== 'READY') return null;
  return createRatingTokenCodecs(configuration.ring).claim;
}

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
