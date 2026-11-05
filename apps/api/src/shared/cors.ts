import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyRequest } from 'fastify';
import {
  PRIVATE_VIEW_CAP_REMAINING_HEADER,
  PRIVATE_VIEW_IDLE_REMAINING_HEADER,
  PRIVATE_VIEW_WINDOW_HEADER,
} from '@pospay/contracts';

export function enableApiCors(
  app: NestFastifyApplication,
  options: {
    trustedOrigins: readonly string[];
    companyHeader: string;
    requestPolicy?: (request: FastifyRequest) => CorsPolicy | undefined;
  },
): void {
  if (options.trustedOrigins.length === 0 && !options.requestPolicy) return;
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
    // تطبيق admin يقرأ المعرّف من الرد ليذكره المستخدم في طلب الدعم.
    exposedHeaders: [
      'x-request-id',
      PRIVATE_VIEW_IDLE_REMAINING_HEADER,
      PRIVATE_VIEW_CAP_REMAINING_HEADER,
    ],
    maxAge: 600,
  };
  app.enableCors({
    delegator: async (request: FastifyRequest) => options.requestPolicy?.(request) ?? authenticated,
  });
}

export type CorsPolicy = {
  origin: string | false;
  credentials: boolean;
  methods: string[];
  allowedHeaders: string[];
  exposedHeaders: string[];
  cacheControl: string;
};
