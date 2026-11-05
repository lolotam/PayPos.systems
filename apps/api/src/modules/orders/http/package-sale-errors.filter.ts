import { Catch, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';

import { ApiError } from '../../../shared/errors.ts';
import { EnvelopeExceptionFilter } from '../../../shared/exception.filter.ts';
import {
  PackageRuleError,
  PackageSaleError,
  PackageSalePricingError,
} from '../use-cases/sell-package/sell-package.usecase.ts';

@Catch(PackageSaleError, PackageSalePricingError, PackageRuleError)
export class PackageSaleErrorsFilter implements ExceptionFilter {
  /**
   * يحوّل رفضات بيع الباقة إلى غلاف HTTP واحد بحالة ورسالة من السجل المشترك.
   *
   * @param error رفض البيع المسمّى من الدومين
   * @param host سياق الاستجابة
   */
  catch(
    error: PackageSaleError | PackageSalePricingError | PackageRuleError,
    host: ArgumentsHost,
  ) {
    if (error instanceof PackageSalePricingError) {
      // INVALID_LIMIT خطأ برمجة في حد الخصم مش رفض مدخل، فبيفضل 500 زي ما هو.
      if (error.code === 'INVALID_LIMIT') throw error;
      new EnvelopeExceptionFilter().catch(new ApiError(error.code, error.details), host);
      return;
    }
    const details = 'details' in error ? error.details : undefined;
    new EnvelopeExceptionFilter().catch(new ApiError(error.code, details), host);
  }
}
