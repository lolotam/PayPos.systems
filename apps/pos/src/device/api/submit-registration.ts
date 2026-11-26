import type { RegisterDeviceInput } from '@pospay/contracts';
import type { Locale } from '@pospay/i18n';
import { t } from '@pospay/i18n';

import { failureText } from '@/shared/api/api-error';

import { saveRegistration } from '../model/credentials';
import { registerDevice } from './device-calls';

// التسجيل بيرجّع كود المطابقة اللي بتعرضه الشاشة للمدير، والخطأ بيرجع كنص زي ما كان.
export async function submitRegistration(
  input: RegisterDeviceInput,
  locale: Locale,
): Promise<{ error: null; checkCode: string } | { error: string }> {
  try {
    const result = await registerDevice(input);
    if (!result.ok) return { error: failureText(result.failure, locale) };
    await saveRegistration(result.data);
    return { error: null, checkCode: result.data.check_code };
  } catch {
    return { error: t(locale, 'pos.networkError') };
  }
}
