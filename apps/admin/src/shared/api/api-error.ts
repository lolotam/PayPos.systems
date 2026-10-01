import { t, type Locale } from '@pospay/i18n';

function isEnvelope(value: unknown): value is { message_ar: string; message_en: string } {
  if (typeof value !== 'object' || value === null) return false;
  const body = value as { message_ar?: unknown; message_en?: unknown };
  return typeof body.message_ar === 'string' && typeof body.message_en === 'string';
}

export function envelopeMessage(error: unknown, locale: Locale): string {
  if (!isEnvelope(error)) return t(locale, 'admin.unexpected');
  return locale === 'ar' ? error.message_ar : error.message_en;
}
