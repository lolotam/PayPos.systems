import { Injectable, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

import { ApiError } from '../../../shared/errors.ts';

/**
 * جسم التصنيف: يتحقق منه العقد، وخطأ الاسم بيرجع بكوده المسمّى (SERVICE_CATEGORY_NAME_INVALID)
 * بدل فشل تحقق عام، عشان الشاشة تعرف ترد على الاسم مش على كل الجسم.
 */
@Injectable()
export class ServiceCategoryValidationPipe<T extends z.ZodType> implements PipeTransform<
  unknown,
  z.output<T>
> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    for (const issue of result.error.issues) {
      if (issue.path[0] === 'name_en' || issue.path[0] === 'name_ar')
        throw new ApiError('SERVICE_CATEGORY_NAME_INVALID');
    }
    throw new ApiError('VALIDATION_FAILED');
  }
}
