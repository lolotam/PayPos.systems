import { Catch, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { serviceSessionErrors } from '@pospay/i18n';
import type { FastifyReply } from 'fastify';
import { ApiError } from '../../../shared/errors.ts';
import { EnvelopeExceptionFilter } from '../../../shared/exception.filter.ts';
import { SessionError } from '../use-cases/record-service-session/record-service-session.usecase.ts';

@Catch(SessionError)
export class SessionErrorsFilter implements ExceptionFilter {
  constructor(private readonly invalidStatus = 422) {}
  catch(error: SessionError, host: ArgumentsHost) {
    if (error.code === 'FORBIDDEN' || error.code === 'FEATURE_DISABLED' || error.code === 'TRANSACTION_RETRY_REQUIRED') {
      new EnvelopeExceptionFilter().catch(new ApiError(error.code, error.details), host);
      return;
    }
    const status = error.code === 'SESSION_PERFORMER_SELF_FORBIDDEN' ? 403 : error.code === 'SESSION_RECORDER_MEMBERSHIP_REQUIRED' ? 400 : this.invalidStatus;
    const envelope = { code: error.code, ...serviceSessionErrors[error.code], ...(error.details === undefined ? {} : { details: error.details }) };
    void host.switchToHttp().getResponse<FastifyReply>().status(status).send(envelope);
  }
}
