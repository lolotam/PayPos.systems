import { t, type Locale } from '@pospay/i18n';
import { envelopeMessage } from '@/shared/api/api-error';

function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

/** رسالة الفشل بحسب الحالة: 403 مش مسموح، 404 الفرع مش تحت النشاط، وغير كده رسالة الخادم ثنائية اللغة. */
export function branchFailureMessage(error: unknown, locale: Locale): string {
  const status = statusOf(error);
  if (status === 401 || status === 403) return t(locale, 'branchHours.notAllowed');
  if (status === 404) return t(locale, 'branchHours.notFound');
  return envelopeMessage(error, locale);
}
