import { Catch, type ArgumentsHost } from '@nestjs/common';
import { ApiError } from '../../../shared/errors.ts';
import { EnvelopeExceptionFilter } from '../../../shared/exception.filter.ts';

// قراءات الحضور تُخفي الفرع غير المصرح به بنفس جواب الفرع المفقود، مع إبقاء حارس الصلاحية المشترك كما هو.
@Catch(ApiError)
export class AttendanceBoardExceptionFilter extends EnvelopeExceptionFilter {
  override catch(error: ApiError, host: ArgumentsHost): void {
    super.catch(error.code === 'FORBIDDEN' ? new ApiError('NOT_FOUND') : error, host);
  }
}
