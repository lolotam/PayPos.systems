import { t, type Locale } from '@pospay/i18n';
import { envelopeMessage } from '@/shared/api/api-error';

function codeOf(error: unknown): { code?: string; status?: number } {
  return (error ?? {}) as { code?: string; status?: number };
}

/** القائمة كلها بتتقفل على 403 لأن صلاحية الرقم مش متخزنة في المتصفح. */
export function companyNumbersListDenied(error: unknown): boolean {
  const value = codeOf(error);
  return value.status === 403 || value.code === 'FORBIDDEN';
}

/** 409 على مسار التعديل هو الرقم المأخوذ، و403 بيرفض الصف من غير ما يخبي باقي القائمة. */
export function companyNumbersEditMessage(error: unknown, locale: Locale): string {
  const value = codeOf(error);
  if (value.code === 'EMPLOYEE_NUMBER_TAKEN' || value.status === 409) {
    return t(locale, 'errors.EMPLOYEE_NUMBER_TAKEN');
  }
  if (value.status === 403 || value.code === 'FORBIDDEN') {
    return t(locale, 'companyEmployeeNumbers.refusal');
  }
  return envelopeMessage(error, locale);
}
