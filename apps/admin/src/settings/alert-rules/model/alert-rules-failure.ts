import { t, type Locale } from '@pospay/i18n';
import { envelopeMessage } from '@/shared/api/api-error';

export function alertRulesStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

export function isAlertRulesRefusal(error: unknown): boolean {
  const status = alertRulesStatus(error);
  return status === 401 || status === 403;
}

export function alertRulesFailureMessage(error: unknown, locale: Locale): string {
  if (isAlertRulesRefusal(error)) return t(locale, 'errors.FORBIDDEN');
  return envelopeMessage(error, locale);
}
