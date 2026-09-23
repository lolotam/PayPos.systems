import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
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
    if (error.code === 'INTERNAL_ERROR') {
      request.log.error({ err: exception }, 'unhandled error');
    }
    void reply.status(error.status).send(error.toEnvelope());
  }
}

function toApiError(exception: unknown): ApiError {
  if (exception instanceof ApiError) return exception;
  if (exception instanceof HttpException) return new ApiError(codeForStatus(exception.getStatus()));
  const status = (exception as { statusCode?: unknown } | null)?.statusCode;
  // Fastify's own errors (e.g. a body over the size limit) carry a statusCode but are not HttpExceptions.
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return new ApiError(codeForStatus(status));
  }
  return new ApiError('INTERNAL_ERROR');
}
