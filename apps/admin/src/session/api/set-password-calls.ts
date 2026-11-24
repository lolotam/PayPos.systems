import type { MessageKey } from '@pospay/i18n';

import { authErrorKey } from './auth-error';
import { browserAuthClient } from './browser-client';

export type SetPasswordOutcome = 'done' | 'invalid-link' | MessageKey;

function isInvalidToken(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  // Better Auth بيرجع INVALID_TOKEN لرابط منتهي أو مستهلك — الرسالة بتاعته هي حالة الصفحة نفسها.
  return error.code === 'INVALID_TOKEN';
}

export async function setPassword(token: string, newPassword: string): Promise<SetPasswordOutcome> {
  try {
    const result = await browserAuthClient().resetPassword({ token, newPassword });
    if (result.error) {
      if (isInvalidToken(result.error)) return 'invalid-link';
      return authErrorKey(result.error);
    }
    return 'done';
  } catch {
    return 'admin.unexpected';
  }
}
