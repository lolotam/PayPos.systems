import { ApiError } from '../../../shared/errors.ts';
import { AttendanceChangeError } from '../use-cases/request-attendance-change/request-attendance-change.usecase.ts';

export async function attendanceChangeHttpResult<T>(result: Promise<T>): Promise<T> {
  try {
    return await result;
  } catch (error) {
    if (error instanceof AttendanceChangeError) throw new ApiError(error.code);
    throw error;
  }
}
