import { t, type Locale } from '@pospay/i18n';
import { envelopeMessage } from '@/shared/api/api-error';

export function importedRefundsStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

export function isImportedRefundsRefusal(error: unknown): boolean {
  const status = importedRefundsStatus(error);
  return status === 401 || status === 403;
}

export function importedRefundsFailureMessage(error: unknown, locale: Locale): string {
  if (isImportedRefundsRefusal(error)) return t(locale, 'importedRefunds.notAllowed');
  return envelopeMessage(error, locale);
}
