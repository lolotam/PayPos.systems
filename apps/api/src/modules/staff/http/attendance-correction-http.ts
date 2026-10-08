import { ApiError } from '../../../shared/errors.ts';
import { AttendanceCorrectionError } from '../use-cases/correct-attendance/correct-attendance.usecase.ts';

export async function attendanceCorrectionHttpResult<T>(result: Promise<T>): Promise<T> {
  try {
    return await result;
  } catch (error) {
    if (error instanceof AttendanceCorrectionError) throw new ApiError(error.code);
    throw error;
  }
}
