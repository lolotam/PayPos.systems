import { ApiError } from '../../../shared/errors.ts';
import { AttendanceExceptionError } from '../use-cases/resolve-attendance-exception/resolve-attendance-exception.usecase.ts';

export async function attendanceExceptionHttpResult<T>(result: Promise<T>): Promise<T> {
  try {
    return await result;
  } catch (error) {
    if (error instanceof AttendanceExceptionError) throw new ApiError(error.code);
    throw error;
  }
}
