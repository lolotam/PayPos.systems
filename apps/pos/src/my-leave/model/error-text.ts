import { t, type Locale, type MessageKey } from '@pospay/i18n';

export function leaveErrorText(error: unknown, locale: Locale): string {
  const key = `errors.${error instanceof Error ? error.message : 'NOT_READY'}` as MessageKey;
  const translated = t(locale, key);
  return translated === key ? t(locale, 'myLeave.failed') : translated;
}
