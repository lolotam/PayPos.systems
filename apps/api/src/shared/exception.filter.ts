import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { IdempotencyKeyBusyError, IdempotencyKeyReusedError } from '@pospay/db';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { ApiError, codeForStatus } from './errors.ts';

/**
 * Every error leaves the API as `{ code, message_ar, message_en, details? }` (CLAUDE.md §6). An
 * unexpected error is logged with its stack and returned as INTERNAL_ERROR — its message never
 * reaches the client, because it can carry SQL, ids or internals.
 */
@Catch()
export class EnvelopeExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const reply = http.getResponse<FastifyReply>();
    const request = http.getRequest<FastifyRequest>();

    const error = toApiError(exception);
    // المسار الذي يعرف طول شباكه يضبط الترويسة بنفسه. 60 تبقى الافتراضي فقط حين تغيب.
    if (error.code === 'TOO_MANY_REQUESTS' && !reply.hasHeader('retry-after'))
      void reply.header('retry-after', '60');
    if (error.code === 'INTERNAL_ERROR') {
      request.log.error({ err: exception }, 'unhandled error');
    }
    void reply.status(error.status).send(error.toEnvelope());
  }
}

function toApiError(exception: unknown): ApiError {
  if (exception instanceof ApiError) return exception;
  if (isRetryableTransactionConflict(exception)) return new ApiError('TRANSACTION_RETRY_REQUIRED');
  // Raised by runIdempotent inside the use case's transaction, which has already rolled back.
  if (exception instanceof IdempotencyKeyReusedError) return new ApiError('IDEMPOTENCY_KEY_REUSED');
  if (exception instanceof IdempotencyKeyBusyError)
    return new ApiError('IDEMPOTENCY_KEY_IN_PROGRESS');
  if (exception instanceof HttpException) return new ApiError(codeForStatus(exception.getStatus()));
  const status = (exception as { statusCode?: unknown } | null)?.statusCode;
  // Fastify's own errors (e.g. a body over the size limit) carry a statusCode but are not HttpExceptions.
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return new ApiError(codeForStatus(status));
  }
  return new ApiError('INTERNAL_ERROR');
}

function isRetryableTransactionConflict(exception: unknown): boolean {
  const seen = new Set<object>();
  let current = exception;
  // Drizzle يغلف خطأ PostgreSQL في cause؛ نعرض طلب إعادة المحاولة بعد rollback بدون تسريب SQL أو الدوران في cause دائري.
  while (typeof current === 'object' && current !== null && !seen.has(current)) {
    seen.add(current);
    const error = current as { code?: unknown; cause?: unknown };
    if (error.code === '40P01' || error.code === '40001') return true;
    current = error.cause;
  }
  return false;
}
