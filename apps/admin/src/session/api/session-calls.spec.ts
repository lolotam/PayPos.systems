import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearSelection, readSelection, writeSelection } from '@/shared/api/selection-cookie';

const mockSignInEmail = vi.fn();
const mockVerifyTotp = vi.fn();
const mockEnable = vi.fn();
const mockGetSession = vi.fn();
const mockSignOut = vi.fn();

vi.mock('./browser-client', () => ({
  browserAuthClient: () => ({
    signIn: { email: mockSignInEmail },
    twoFactor: { verifyTotp: mockVerifyTotp, enable: mockEnable },
    getSession: mockGetSession,
    signOut: mockSignOut,
  }),
}));

import {
  enableTotp,
  loadBrowserSession,
  signInWithPassword,
  signOutSession,
  verifyTotpCode,
} from './session-calls';

const COMPANY_ID = '01923f66-3d2b-7c00-8000-000000000001';

function testSignIn(): void {
  it('maps known errors, redirects to totp, signals done, or handles thrown errors', async () => {
    mockSignInEmail.mockResolvedValueOnce({ error: { code: 'INVALID_EMAIL_OR_PASSWORD' } });
    expect(await signInWithPassword('test@pospay.systems', 'wrong')).toBe('admin.signInFailed');

    mockSignInEmail.mockResolvedValueOnce({ error: { code: 'UNKNOWN_CODE' } });
    expect(await signInWithPassword('test@pospay.systems', 'pass')).toBe('admin.unexpected');

    mockSignInEmail.mockResolvedValueOnce({ data: { twoFactorRedirect: true } });
    expect(await signInWithPassword('test@pospay.systems', 'pass')).toBe('totp');

    mockSignInEmail.mockResolvedValueOnce({ data: { user: { id: 'u1' } } });
    expect(await signInWithPassword('test@pospay.systems', 'pass')).toBe('done');

    mockSignInEmail.mockRejectedValueOnce(new Error('Network error'));
    expect(await signInWithPassword('test@pospay.systems', 'pass')).toBe('admin.unexpected');
  });
}

function testTotp(): void {
  it('verifies TOTP code on success and maps error code or thrown error', async () => {
    mockVerifyTotp.mockResolvedValueOnce({ data: { status: true } });
    expect(await verifyTotpCode('123456')).toBeUndefined();

    mockVerifyTotp.mockResolvedValueOnce({ error: { code: 'INVALID_CODE' } });
    expect(await verifyTotpCode('000000')).toBe('admin.invalidCode');

    mockVerifyTotp.mockRejectedValueOnce(new Error('crash'));
    expect(await verifyTotpCode('123456')).toBe('admin.unexpected');
  });

  it('enables TOTP returning URI and backup codes, or error key', async () => {
    const enrolment = {
      totpURI: 'otpauth://totp/PosPay:admin?secret=ABC',
      backupCodes: ['code1', 'code2'],
    };
    mockEnable.mockResolvedValueOnce({ data: enrolment });
    expect(await enableTotp('pass')).toEqual(enrolment);

    mockEnable.mockResolvedValueOnce({ error: { code: 'TOTP_ALREADY_ENABLED' } });
    expect(await enableTotp('pass')).toBe('admin.totpAlreadyOn');

    mockEnable.mockResolvedValueOnce({ data: { totpURI: 'bad-shape' } });
    expect(await enableTotp('pass')).toBe('admin.unexpected');

    mockEnable.mockRejectedValueOnce(new Error('crash'));
    expect(await enableTotp('pass')).toBe('admin.unexpected');
  });
}

function testSignOut(): void {
  it('clears selection cookies only on successful sign out', async () => {
    writeSelection({ companyId: COMPANY_ID });
    mockSignOut.mockResolvedValueOnce({ data: { success: true } });
    const result = await signOutSession();
    expect(result).toBe(true);
    expect(readSelection().companyId).toBeUndefined();

    writeSelection({ companyId: COMPANY_ID });
    mockSignOut.mockResolvedValueOnce({ error: { message: 'signout failed' } });
    const failResult = await signOutSession();
    expect(failResult).toBe(false);
    expect(readSelection().companyId).toBe(COMPANY_ID);

    mockSignOut.mockRejectedValueOnce(new Error('fail'));
    const thrownResult = await signOutSession();
    expect(thrownResult).toBe(false);
    expect(readSelection().companyId).toBe(COMPANY_ID);
  });
}

function testLoadSession(): void {
  it('classifies browser session as in or out and rethrows non-auth errors', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { user: { id: 'u1' } } });
    expect(await loadBrowserSession()).toBe('in');

    mockGetSession.mockResolvedValueOnce({ data: null });
    expect(await loadBrowserSession()).toBe('out');

    mockGetSession.mockResolvedValueOnce({ error: { status: 401 } });
    expect(await loadBrowserSession()).toBe('out');

    const serverErr = { status: 500, message: 'Internal Server Error' };
    mockGetSession.mockResolvedValueOnce({ error: serverErr });
    await expect(loadBrowserSession()).rejects.toEqual(serverErr);
  });
}

describe('session-calls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSelection();
  });

  afterEach(() => {
    clearSelection();
  });

  testSignIn();
  testTotp();
  testSignOut();
  testLoadSession();
});
