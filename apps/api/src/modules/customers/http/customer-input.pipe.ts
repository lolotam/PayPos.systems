import type { PipeTransform } from '@nestjs/common';
import { findOrCreateCustomerInput, type FindOrCreateCustomerInput } from '@pospay/contracts';

import { ApiError } from '../../../shared/errors.ts';

export class CustomerInputPipe implements PipeTransform<unknown, FindOrCreateCustomerInput> {
  transform(value: unknown): FindOrCreateCustomerInput {
    const parsed = findOrCreateCustomerInput.safeParse(value);
    if (parsed.success) return parsed.data;
    const code = parsed.error.issues.some((issue) => issue.path[0] === 'phone')
      ? 'INVALID_CUSTOMER_PHONE'
      : 'VALIDATION_FAILED';
    throw new ApiError(code);
  }
}
