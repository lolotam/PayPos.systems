import type { RegisterDeviceInput } from '@pospay/contracts';
import type { Locale } from '@pospay/i18n';
import { t } from '@pospay/i18n';

import { failureText } from '@/shared/api/api-error';

import { saveRegistration } from '../model/credentials';
import { registerDevice } from './device-calls';

export async function submitRegistration(
  input: RegisterDeviceInput,
  locale: Locale,
): Promise<string | null> {
  try {
    const result = await registerDevice(input);
    if (!result.ok) return failureText(result.failure, locale);
    await saveRegistration(result.data);
    return null;
  } catch {
    return t(locale, 'pos.networkError');
  }
}
