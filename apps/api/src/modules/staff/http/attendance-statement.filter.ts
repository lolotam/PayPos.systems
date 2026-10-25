import { Catch, type ArgumentsHost } from '@nestjs/common';

import { ApiError, type ErrorCode } from '../../../shared/errors.ts';
import { EnvelopeExceptionFilter } from '../../../shared/exception.filter.ts';
import { AttendanceStatementError } from '../use-cases/request-attendance-statement/request-attendance-statement.usecase.ts';

const CODES: Readonly<Record<AttendanceStatementError['code'], ErrorCode>> = {
  BRANCH_NOT_FOUND: 'ATTENDANCE_STATEMENT_BRANCH_NOT_FOUND',
  PERIOD_INVALID: 'ATTENDANCE_STATEMENT_PERIOD_INVALID',
  SHIFT_FILTER_INVALID: 'ATTENDANCE_STATEMENT_SHIFT_FILTER_INVALID',
  EMPLOYEE_NOT_FOUND: 'ATTENDANCE_STATEMENT_EMPLOYEE_NOT_FOUND',
  RATE_LIMITED: 'ATTENDANCE_STATEMENT_RATE_LIMITED',
  RENDERER_UNAVAILABLE: 'RENDERER_UNAVAILABLE',
  NOT_FOUND: 'NOT_FOUND',
  NOT_READY: 'DOCUMENT_NOT_READY',
  EXPIRED: 'DOCUMENT_EXPIRED',
};

// رفض البيان مالهوش ترجمة في المرشح العام، فبنترجمه هنا لكل مسارات البيان.
@Catch(AttendanceStatementError)
export class AttendanceStatementErrorFilter extends EnvelopeExceptionFilter {
  override catch(exception: AttendanceStatementError, host: ArgumentsHost): void {
    super.catch(new ApiError(CODES[exception.code]), host);
  }
}
