import type { PipeTransform } from '@nestjs/common';
import {
  findOrCreateCustomerInput,
  findOrCreateScopedCustomerInput,
  type FindOrCreateCustomerInput,
  type FindOrCreateScopedCustomerInput,
} from '@pospay/contracts';
import type { z } from 'zod';

import { ApiError } from '../../../shared/errors.ts';

// الرفض بيكود بس: نصوص Zod ومساراتها والقيم المرفوضة ما بتتكررش في الخطأ (D-10).
function parseCustomerInput<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const code = parsed.error.issues.some((issue) => issue.path[0] === 'phone')
    ? 'INVALID_CUSTOMER_PHONE'
    : 'VALIDATION_FAILED';
  throw new ApiError(code);
}

export class CustomerInputPipe implements PipeTransform<unknown, FindOrCreateCustomerInput> {
  transform(value: unknown): FindOrCreateCustomerInput {
    return parseCustomerInput(findOrCreateCustomerInput, value);
  }
}

// مسار النشاط ومسار الفرع بيقبلوا note كمان؛ مسار الشركة لأ (S-4).
export class ScopedCustomerInputPipe implements PipeTransform<
  unknown,
  FindOrCreateScopedCustomerInput
> {
  transform(value: unknown): FindOrCreateScopedCustomerInput {
    return parseCustomerInput(findOrCreateScopedCustomerInput, value);
  }
}
