import type { MessageKey } from '@pospay/i18n';

const KNOWN: Record<string, MessageKey> = {
  INVALID_EMAIL_OR_PASSWORD: 'admin.signInFailed',
  INVALID_CODE: 'admin.invalidCode',
  INVALID_PASSWORD: 'admin.invalidPassword',
  TOTP_ALREADY_ENABLED: 'admin.totpAlreadyOn',
};

export function authErrorKey(error: unknown): MessageKey {
  if (typeof error !== 'object' || error === null || !('code' in error)) return 'admin.unexpected';
  const code = error.code;
  if (typeof code !== 'string') return 'admin.unexpected';
  return KNOWN[code] ?? 'admin.unexpected';
}

export function anonymousStatus(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('status' in error)) return false;
  return error.status === 401;
}

export function hasUser(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || !('user' in value)) return false;
  const user = value.user;
  return typeof user === 'object' && user !== null && 'id' in user && typeof user.id === 'string';
}

export function redirectsToTotp(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'twoFactorRedirect' in value &&
    value.twoFactorRedirect === true
  );
}

export function readEnrolment(value: unknown): { totpURI: string; backupCodes: string[] } | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  if (!('totpURI' in value) || typeof value.totpURI !== 'string') return undefined;
  if (!('backupCodes' in value) || !Array.isArray(value.backupCodes)) return undefined;
  const backupCodes: string[] = [];
  for (const code of value.backupCodes) {
    if (typeof code !== 'string') return undefined;
    backupCodes.push(code);
  }
  return { totpURI: value.totpURI, backupCodes };
}
