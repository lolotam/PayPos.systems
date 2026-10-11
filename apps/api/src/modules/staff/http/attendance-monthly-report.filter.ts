import { Catch, type ArgumentsHost } from '@nestjs/common';
import { ApiError } from '../../../shared/errors.ts';
import { EnvelopeExceptionFilter } from '../../../shared/exception.filter.ts';

// الـ guard العام يرفض النطاق بـ FORBIDDEN؛ قراءة الحضور توحّده مع الفرع المجهول وفق AB-Q2.
@Catch(ApiError)
export class AttendanceReportNotFoundFilter extends EnvelopeExceptionFilter {
  override catch(exception: ApiError, host: ArgumentsHost): void {
    super.catch(exception.code === 'FORBIDDEN' ? new ApiError('NOT_FOUND') : exception, host);
  }
}
