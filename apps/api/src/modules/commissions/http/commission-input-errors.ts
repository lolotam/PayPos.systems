import {
  IdempotencyKeyBusyError,
  IdempotencyKeyReusedError,
  StatementPeriodClosedError,
} from '@pospay/db';

import { ApiError } from '../../../shared/errors.ts';
import { CommissionPlanVersionError } from '../use-cases/create-commission-plan-version/create-commission-plan-version.usecase.ts';

/**
 * يرفض الكتابة بالخطأ المعروف: خطأ الـ domain يبقى كوده، والاستخدام المتكرر للمفتاح خطأ 422،
 * والمفتاح الشغال خطأ 409. أي خطأ تاني بيروح زي ما هو عشان يبقى 500 مش رفض متخفّي.
 *
 * @param error الخطأ اللي خرج من حالة الاستخدام
 * @returns عمره ما بيرجع: بيرمي الخطأ المعروف أو بيرمي الأصلي
 */
export function mapCommissionWriteError(error: unknown): never {
  if (error instanceof CommissionPlanVersionError) {
    throw new ApiError(error.code, error.details);
  }
  if (error instanceof StatementPeriodClosedError) {
    throw new ApiError('COMMISSION_PERIOD_CLOSED');
  }
  if (error instanceof IdempotencyKeyReusedError) throw new ApiError('IDEMPOTENCY_KEY_REUSED');
  if (error instanceof IdempotencyKeyBusyError) throw new ApiError('IDEMPOTENCY_KEY_IN_PROGRESS');
  throw error;
}
