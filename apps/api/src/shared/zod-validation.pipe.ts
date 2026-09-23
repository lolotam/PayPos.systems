import type { PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

import { ApiError } from './errors.ts';

/**
 * Validates a request part against a contract from `@pospay/contracts` and returns the parsed value
 * (defaults applied, unknown keys refused by strict schemas). A failure becomes VALIDATION_FAILED with
 * the issue paths and codes only — never the rejected values, which may be secrets.
 */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.output<T>> {
  readonly #schema: T;

  constructor(schema: T) {
    this.#schema = schema;
  }

  transform(value: unknown): z.output<T> {
    const result = this.#schema.safeParse(value);
    if (!result.success) {
      throw new ApiError(
        'VALIDATION_FAILED',
        result.error.issues.map((issue) => ({ path: issue.path.map(String), code: issue.code })),
      );
    }
    return result.data;
  }
}
