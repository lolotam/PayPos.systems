import { t, type Locale } from '@pospay/i18n';
import { envelopeMessage } from '@/shared/api/api-error';

export function ratingsRefused(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const status = (error as { status?: unknown }).status;
  return status === 401 || status === 403;
}

export function ratingsFailureMessage(error: unknown, locale: Locale): string {
  return ratingsRefused(error) ? t(locale, 'ratings.notAllowed') : envelopeMessage(error, locale);
}
