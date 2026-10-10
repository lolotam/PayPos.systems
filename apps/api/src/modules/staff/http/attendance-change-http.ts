import { errorMessages, type ErrorMessageCode } from '@pospay/i18n';
import { ApiError } from '../../../shared/errors.ts';
import {
  AttendanceChangeError,
  AttendanceChangeKindRefusal,
} from '../use-cases/request-attendance-change/request-attendance-change.usecase.ts';

class AttendanceChangeKindHttpError extends ApiError {
  constructor(private readonly refusal: AttendanceChangeKindRefusal) {
    super('BAD_REQUEST');
  }
  override get status() {
    return this.refusal.status;
  }
  override toEnvelope() {
    const messages = errorMessages(this.refusal.code as ErrorMessageCode);
    return {
      code: this.refusal.code,
      ...(typeof messages.message_ar === 'string' && typeof messages.message_en === 'string'
        ? messages
        : errorMessages('BAD_REQUEST')),
    };
  }
}

export async function attendanceChangeHttpResult<T>(result: Promise<T>): Promise<T> {
  try {
    return await result;
  } catch (error) {
    if (error instanceof AttendanceChangeKindRefusal)
      throw new AttendanceChangeKindHttpError(error);
    if (error instanceof AttendanceChangeError) throw new ApiError(error.code);
    throw error;
  }
}
