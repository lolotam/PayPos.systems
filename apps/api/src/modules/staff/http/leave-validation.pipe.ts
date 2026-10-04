import type { PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { ApiError } from '../../../shared/errors.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';

// يحافظ حد HTTP على رموز حدود الإجازة المترجمة دون كشف القيم المرفوضة.
export class LeaveValidationPipe<T extends z.ZodType> implements PipeTransform<
  unknown,
  z.output<T>
> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    for (const issue of result.error.issues) {
      if (issue.message === 'LEAVE_TIME_STEP_INVALID' || issue.message === 'LEAVE_SPAN_TOO_LONG')
        throw new ApiError(issue.message);
    }
    return new ZodValidationPipe(this.schema).transform(value);
  }
}
