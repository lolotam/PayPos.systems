import { RATING_TOKEN_HEADER } from '@pospay/contracts';
import type { FastifyRequest } from 'fastify';
import type { CorsPolicy } from '../../../shared/cors.ts';

/** الصفحة العامة لا ترث ثقة تسجيل الدخول حتى لو جاء الطلب من عنوان admin. */
export function ratingCorsPolicy(origin: string) {
  return (request: FastifyRequest): CorsPolicy | undefined => {
    let path: string;
    try {
      // Fastify يفك ترميز حروف المسار؛ تصنيف CORS لازم يطابق المسار الذي يختاره الراوتر.
      path = decodeURI(request.url.split('?')[0] ?? '');
    } catch {
      return undefined;
    }
    const rating = /^\/v1\/ratings\/(view|submit|opt-out)$/.exec(path ?? '');
    if (!rating) return undefined;
    return {
      origin: origin !== '' && request.headers.origin === origin ? origin : false,
      credentials: false,
      methods: [rating[1] === 'view' ? 'GET' : 'POST', 'OPTIONS'],
      allowedHeaders: ['content-type', RATING_TOKEN_HEADER],
      exposedHeaders: ['retry-after'],
      cacheControl: 'no-store',
    };
  };
}
