import type { MessageKey } from '@pospay/i18n';

import { clearSelection } from '@/shared/api/selection-cookie';

import {
  anonymousStatus,
  authErrorKey,
  hasUser,
  readEnrolment,
  redirectsToTotp,
} from './auth-error';
import { browserAuthClient } from './browser-client';

export type SignInOutcome = 'totp' | 'done' | MessageKey;

export async function signInWithPassword(email: string, password: string): Promise<SignInOutcome> {
  try {
    const result = await browserAuthClient().signIn.email({ email, password });
    if (result.error) return authErrorKey(result.error);
    if (redirectsToTotp(result.data)) return 'totp';
    return 'done';
  } catch {
    return 'admin.unexpected';
  }
}

// TODO(spec): trustDevice is not sent — the spec does not define a trusted device.
export async function verifyTotpCode(code: string): Promise<MessageKey | undefined> {
  try {
    const result = await browserAuthClient().twoFactor.verifyTotp({ code });
    if (result.error) return authErrorKey(result.error);
    return undefined;
  } catch {
    return 'admin.unexpected';
  }
}

export async function enableTotp(
  password: string,
): Promise<{ totpURI: string; backupCodes: string[] } | MessageKey> {
  try {
    const result = await browserAuthClient().twoFactor.enable({ password, method: 'totp' });
    if (result.error) return authErrorKey(result.error);
    return readEnrolment(result.data) ?? 'admin.unexpected';
  } catch {
    return 'admin.unexpected';
  }
}

export async function loadBrowserSession(): Promise<'in' | 'out'> {
  const result = await browserAuthClient().getSession();
  if (result.error) {
    if (anonymousStatus(result.error)) return 'out';
    throw result.error;
  }
  return hasUser(result.data) ? 'in' : 'out';
}

export async function readSessionUserId(): Promise<string | null> {
  const result = await browserAuthClient().getSession();
  if (result.error) {
    if (anonymousStatus(result.error)) return null;
    throw result.error;
  }
  return hasUser(result.data) ? result.data.user.id : null;
}

export async function signOutSession(): Promise<boolean> {
  try {
    const result = await browserAuthClient().signOut();
    if (result.error) return false;
    clearSelection();
    return true;
  } catch {
    return false;
  }
}
