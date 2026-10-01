import { t, type Locale } from '@pospay/i18n';

import type { Failure } from './call';

export function failureText(failure: Failure, locale: Locale): string {
  if (failure.kind === 'network') return t(locale, 'pos.networkError');
  if (failure.envelope === null) return t(locale, 'pos.unexpected');
  return locale === 'ar' ? failure.envelope.message_ar : failure.envelope.message_en;
}
