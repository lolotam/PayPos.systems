import { Injectable, type PipeTransform } from '@nestjs/common';
import { createEmployeeInput, type CreateEmployeeInput } from '@pospay/contracts';
import { ApiError } from '../../../shared/errors.ts';

@Injectable()
export class EmployeeInputPipe implements PipeTransform<unknown, CreateEmployeeInput> {
  transform(value: unknown): CreateEmployeeInput {
    const parsed = createEmployeeInput.safeParse(value);
    if (!parsed.success) throw new ApiError('VALIDATION_FAILED');
    return parsed.data;
  }
}
