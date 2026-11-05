import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyRequest } from 'fastify';
import {
  PRIVATE_VIEW_CAP_REMAINING_HEADER,
  PRIVATE_VIEW_IDLE_REMAINING_HEADER,
  PRIVATE_VIEW_WINDOW_HEADER,
  RATING_TOKEN_HEADER,
} from '@pospay/contracts';

export function enableApiCors(
  app: NestFastifyApplication,
  options: { trustedOrigins: readonly string[]; ratingPageOrigin: string; companyHeader: string },
): void {
  if (options.trustedOrigins.length === 0 && !options.ratingPageOrigin) return;
  const authenticated = {
    origin: [...options.trustedOrigins],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: [
      'content-type',
      'idempotency-key',
      'x-request-id',
      'authorization',
      'x-recovery-key',
      options.companyHeader,
      PRIVATE_VIEW_WINDOW_HEADER,
    ],
    // The admin app reads the id back to quote it in a support request.
    exposedHeaders: [
      'x-request-id',
      PRIVATE_VIEW_IDLE_REMAINING_HEADER,
      PRIVATE_VIEW_CAP_REMAINING_HEADER,
    ],
    maxAge: 600,
  };
  app.enableCors({
    delegator: async (request: FastifyRequest) => {
      const path = request.url.split('?')[0];
      const rating = /^\/v1\/ratings\/(view|submit|opt-out)$/.exec(path ?? '');
      if (!rating) return authenticated;
      // الصفحة العامة لا ترث ثقة تسجيل الدخول حتى لو جاء الطلب من عنوان admin.
      return {
        origin:
          options.ratingPageOrigin !== '' && request.headers.origin === options.ratingPageOrigin
            ? options.ratingPageOrigin
            : false,
        credentials: false,
        methods: [rating[1] === 'view' ? 'GET' : 'POST', 'OPTIONS'],
        allowedHeaders: ['content-type', RATING_TOKEN_HEADER],
        exposedHeaders: ['retry-after'],
        cacheControl: 'no-store',
      };
    },
  });
}
