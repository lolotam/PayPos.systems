import { t, type Locale } from '@pospay/i18n';
import { envelopeMessage } from '@/shared/api/api-error';

function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

/** الرفض بالصلاحية (401 أو 403) مالوش زر إعادة محاولة، لأن إعادة القراءة هترجع نفس الرفض. */
export function isStaffColumnsRefusal(error: unknown): boolean {
  const status = statusOf(error);
  return status === 401 || status === 403;
}

/** نص الخطأ: الرفض بالصلاحية نص ثابت، وكل حاجة تانية ظرف السيرفر. */
export function staffColumnsFailureMessage(error: unknown, locale: Locale): string {
  if (isStaffColumnsRefusal(error)) return t(locale, 'errors.FORBIDDEN');
  return envelopeMessage(error, locale);
}
