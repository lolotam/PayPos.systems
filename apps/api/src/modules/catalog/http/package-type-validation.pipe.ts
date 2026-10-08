import { Injectable, type PipeTransform } from '@nestjs/common';
import { createPackageTypeInput, updatePackageTypeInput } from '@pospay/contracts';
import { ApiError } from '../../../shared/errors.ts';

@Injectable()
export class PackageTypeValidationPipe implements PipeTransform {
  constructor(private readonly update = false) {}

  transform(value: unknown) {
    const result = (this.update ? updatePackageTypeInput : createPackageTypeInput).safeParse(value);
    if (result.success) return result.data;
    const issue = result.error.issues[0];
    if (issue?.path[0] === 'price') throw new ApiError('PACKAGE_TYPE_PRICE_INVALID');
    if (issue?.path[0] === 'validity_days') throw new ApiError('PACKAGE_TYPE_VALIDITY_INVALID');
    if (issue?.path[0] === 'components') {
      if (issue.message === 'PACKAGE_TYPE_DUPLICATE_SERVICE')
        throw new ApiError('PACKAGE_TYPE_DUPLICATE_SERVICE');
      if (issue.path.includes('sessions')) throw new ApiError('PACKAGE_TYPE_INVALID_SESSIONS');
      throw new ApiError('PACKAGE_TYPE_INVALID_COMPONENTS');
    }
    if (issue?.path[0] === 'name_en' || issue?.path[0] === 'name_ar')
      throw new ApiError('PACKAGE_TYPE_NAME_INVALID');
    throw new ApiError('VALIDATION_FAILED');
  }
}
