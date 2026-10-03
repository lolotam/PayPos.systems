import { ApiError } from '../../../shared/errors.ts';
import { ScheduleError } from '../use-cases/set-schedule/set-schedule.usecase.ts';

export async function scheduleHttpResult<T>(operation: Promise<T>): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    if (error instanceof ScheduleError) throw new ApiError(error.code, error.details);
    throw error;
  }
}
