import type { FastifyReply, FastifyRequest } from 'fastify';

import { ApiError, type ErrorCode } from '../../../shared/errors.ts';
import type { RateLimiter } from '../../../shared/ports/rate-limiter.port.ts';

/** أقصى محاولات في الدقيقة من عنوان واحد على مسارات التقييم العامة (D-B10، RT-20). */
export const RATING_PUBLIC_LIMIT = 30;
/** طول شباك الحد بالثواني. */
export const RATING_PUBLIC_WINDOW_SECONDS = 60;

/**
 * المسارات العامة للتقييم: أي مسار تحت `ratings/`.
 * البادئة `v1` بتتك لوحدها مشروطة، لأن التسجيل ممكن يسبّق البادئة أو يجي بعدها — والحد لازم يتركب في الحالتين.
 */
export const RATING_ROUTE = /^\/(?:v1\/)?ratings\//;

/** حالة البوابة العامة لمسارات التقييم: هل القدرة موجودة، وهل العدّاد متاح. */
export interface RatingAdmission {
  /** العدّاد المشترك؛ null لما Redis مش متظبّط — المسار بيرد NOT_READY. */
  readonly limiter: RateLimiter | null;
  /** هل القدرة متاحة؛ false من غير proxy موثوق — المسار بيرد NOT_READY. */
  readonly available: boolean;
}

/**
 * بوابة الدخول لمسارات التقييم العامة: بتتحقق من القدرة، وبعدين من حد المحاولات، وبعدين بس يعدّي الطلب.
 * العدّ بيحصل قبل أي parsing للمحتوى وقبل أي وصول لقاعدة البيانات، فالتوكن المش مظبوط بيحصل على نفس العدّ
 * من التوكن المظبوط (RT-20). أي فشل في العدّاد — رد مش صالح أو رفض من Redis — بيقفل المسار بـ NOT_READY،
 * لأن فتح الباب بدون عدّ أحسن من رفض زائر شرعي.
 *
 * @param admission حالة القدرة والعدّاد
 * @returns خطّاف Fastify يرد قبل أي handler
 */
export function ratingAdmissionHook(
  admission: RatingAdmission,
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async (request, reply) => {
    // التوكن في هيدر الطلب: الرد ما يتخزّنش في الكاش ولا في الـ referrer.
    void reply.header('cache-control', 'no-store');
    void reply.header('referrer-policy', 'no-referrer');
    if (!admission.available) {
      refuse(reply, 'NOT_READY');
      return;
    }
    const limiter = admission.limiter;
    if (limiter === null) {
      refuse(reply, 'NOT_READY');
      return;
    }
    const key = `rating-public:${request.ip}`;
    let allowed: boolean;
    try {
      allowed = await limiter.hit(key, RATING_PUBLIC_LIMIT, RATING_PUBLIC_WINDOW_SECONDS);
    } catch {
      refuse(reply, 'NOT_READY');
      return;
    }
    if (allowed) return;
    let remaining: number;
    try {
      remaining = await limiter.remaining(key);
    } catch {
      refuse(reply, 'NOT_READY');
      return;
    }
    // الشبكة الحقيقية هي اللي بتحدد إعادة المحاولة، وأقل من ثانية معناها جرّب تاني حالاً.
    void reply.header('retry-after', String(Math.max(1, Math.ceil(remaining))));
    refuse(reply, 'TOO_MANY_REQUESTS');
  };
}

function refuse(reply: FastifyReply, code: ErrorCode): void {
  const error = new ApiError(code);
  void reply.code(error.status).send(error.toEnvelope());
}
