import { t, type Locale } from '@pospay/i18n';
import { envelopeMessage } from '@/shared/api/api-error';

function codeOf(error: unknown): { code?: string; status?: number } {
  return (error ?? {}) as { code?: string; status?: number };
}

function uncoded(value: { code?: string; status?: number }, status: number) {
  return value.code === undefined && value.status === status;
}

/** «ممنوع الوصول» بس لـ FORBIDDEN أو 403 من غير كود؛ أي كود تاني ليه رسالة الظرف بتاعته. */
export function companyNumbersListDenied(error: unknown): boolean {
  const value = codeOf(error);
  return value.code === 'FORBIDDEN' || uncoded(value, 403);
}

/** المأخوذ والرفض بيتحددوا بالكود، والـ status يتقرأ بس لما الكود يكون غايب. */
export function companyNumbersEditMessage(error: unknown, locale: Locale): string {
  const value = codeOf(error);
  if (value.code === 'EMPLOYEE_NUMBER_TAKEN' || uncoded(value, 409)) {
    return t(locale, 'errors.EMPLOYEE_NUMBER_TAKEN');
  }
  if (value.code === 'FORBIDDEN' || uncoded(value, 403)) {
    return t(locale, 'companyEmployeeNumbers.refusal');
  }
  return envelopeMessage(error, locale);
}
