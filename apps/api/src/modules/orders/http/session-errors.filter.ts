import { Catch, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { serviceSessionErrors } from '@pospay/i18n';
import type { FastifyReply } from 'fastify';
import { ApiError } from '../../../shared/errors.ts';
import { EnvelopeExceptionFilter } from '../../../shared/exception.filter.ts';
import { SessionError } from '../use-cases/record-service-session/record-service-session.usecase.ts';

// عضوية التعديل 422 لأن الجسم سليم والاختيار قاعدة نطاق؛ عضوية التسجيل تبقى 400.
const EDIT_UNPROCESSABLE = new Set<string>([
  'SESSION_EDIT_NO_CHANGE', 'SESSION_LINE_NOT_EDITABLE', 'SESSION_EDIT_REASON_INVALID',
  'SESSION_EDITOR_MEMBERSHIP_REQUIRED', 'SESSION_EDIT_IDENTITY_UNKNOWN',
]);
const TIP_UNPROCESSABLE = new Set<string>([
  'TIP_WINDOW_CLOSED', 'TIP_SELF_FORBIDDEN', 'TIP_IDENTITY_UNKNOWN', 'TIP_EMPLOYEE_NOT_PERFORMER',
  'TIP_TOTAL_TOO_LARGE', 'TIP_REASON_REQUIRED', 'TIP_NO_CHANGE',
]);
// سبب الإلغاء والمنع يصلان 422 حتى لو فُتح الفلتر بحالة 400، مثل سبب التعديل.
const CANCEL_UNPROCESSABLE = new Set<string>([
  'SESSION_LINE_ALREADY_CANCELLED', 'SESSION_CANCEL_REASON_INVALID', 'SESSION_CANCEL_BLOCKED_BY_TIP',
  'SESSION_LINE_IDENTITY_UNKNOWN', 'SESSION_CANCELLER_MEMBERSHIP_REQUIRED', 'SESSION_LINE_NOT_CANCELLABLE',
]);

function sessionErrorHttpStatus(code: string, invalidStatus: number): number {
  if (code === 'SESSION_PERFORMER_SELF_FORBIDDEN') return 403;
  if (code === 'SESSION_RECORDER_MEMBERSHIP_REQUIRED') return 400;
  // جلسة مجهولة أو خارج الفرع 404 بلا تمييز، وتعارض مراجعة البقشيش 409 مثل تعارض سطر.
  if (code === 'SESSION_RECOVERY_NOT_FOUND' || code === 'SESSION_NOT_FOUND') return 404;
  if (code === 'SESSION_RECOVERY_NOT_YET' || code === 'SESSION_RECOVERY_CLOSED' || code === 'SESSION_LINE_REVISION_STALE' || code === 'TIP_REVISION_CONFLICT') return 409;
  if (EDIT_UNPROCESSABLE.has(code) || TIP_UNPROCESSABLE.has(code) || CANCEL_UNPROCESSABLE.has(code)) return 422;
  return invalidStatus;
}

@Catch(SessionError)
export class SessionErrorsFilter implements ExceptionFilter {
  constructor(private readonly invalidStatus = 422) {}
  catch(error: SessionError, host: ArgumentsHost) {
    if (error.code === 'FORBIDDEN' || error.code === 'FEATURE_DISABLED' || error.code === 'TRANSACTION_RETRY_REQUIRED' || error.code === 'IDEMPOTENCY_KEY_REUSED') {
      new EnvelopeExceptionFilter().catch(new ApiError(error.code, error.details), host);
      return;
    }
    const status = sessionErrorHttpStatus(error.code, this.invalidStatus);
    const envelope = { code: error.code, ...serviceSessionErrors[error.code], ...(error.details === undefined ? {} : { details: error.details }) };
    void host.switchToHttp().getResponse<FastifyReply>().status(status).send(envelope);
  }
}
