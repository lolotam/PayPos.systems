import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearNavStyleCookie } from '@/shared/nav-style/nav-style-cookie';

import { useSignIn } from './use-sign-in';
import { useSignOut } from './use-sign-out';
import { useVerifyTotp } from './use-verify-totp';

const calls = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signOutSession: vi.fn(),
  verifyTotpCode: vi.fn(),
}));
const page = vi.hoisted(() => ({ loadPage: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('./session-calls', () => calls);
vi.mock('@/shared/browser/load-page', () => page);

function storedStyle(): string | undefined {
  return document.cookie
    .split('; ')
    .find((pair) => pair.startsWith('pospay_nav_style='))
    ?.split('=')[1];
}

// ما يراه المتصفح لحظة الانتقال نفسها: الكوكي يجب أن يكون ممسوحًا قبلها لا بعدها.
let cookieAtNavigation: string | undefined = 'not navigated';

function pickStyleB(): void {
  document.cookie = 'pospay_nav_style=B; Path=/';
  expect(storedStyle()).toBe('B');
}

beforeEach(() => {
  vi.clearAllMocks();
  cookieAtNavigation = 'not navigated';
  page.loadPage.mockImplementation(() => {
    cookieAtNavigation = storedStyle();
  });
  pickStyleB();
});
afterEach(clearNavStyleCookie);

describe('the device navigation style at sign-out', () => {
  it('clears the style before leaving after a confirmed sign-out', async () => {
    calls.signOutSession.mockResolvedValue(true);
    const { result } = renderHook(() => useSignOut());
    await act(() => result.current.submit());
    expect(page.loadPage).toHaveBeenCalledWith('/login');
    expect(cookieAtNavigation).toBeUndefined();
  });

  it('keeps the style when the server refused the sign-out', async () => {
    calls.signOutSession.mockResolvedValue(false);
    const { result } = renderHook(() => useSignOut());
    await act(() => result.current.submit());
    expect(storedStyle()).toBe('B');
    expect(page.loadPage).not.toHaveBeenCalled();
    expect(result.current.failed).toBe(true);
  });

});

describe('the device navigation style at sign-in', () => {
  it('clears the style before entering the dashboard after a password sign-in', async () => {
    calls.signInWithPassword.mockResolvedValue('done');
    const { result } = renderHook(() => useSignIn());
    await act(() => result.current.submit({ email: 'a@b.co', password: 'x' }));
    expect(page.loadPage).toHaveBeenCalledWith('/');
    expect(cookieAtNavigation).toBeUndefined();
  });

  it('keeps the style while the password step only asks for the second factor', async () => {
    calls.signInWithPassword.mockResolvedValue('totp');
    const { result } = renderHook(() => useSignIn());
    await act(() => result.current.submit({ email: 'a@b.co', password: 'x' }));
    expect(storedStyle()).toBe('B');
    expect(page.loadPage).not.toHaveBeenCalled();
  });

  it('keeps the style when the password is wrong', async () => {
    calls.signInWithPassword.mockResolvedValue('admin.unexpected');
    const { result } = renderHook(() => useSignIn());
    await act(() => result.current.submit({ email: 'a@b.co', password: 'x' }));
    expect(storedStyle()).toBe('B');
    expect(page.loadPage).not.toHaveBeenCalled();
  });

  it('clears the style before entering the dashboard after the second factor', async () => {
    calls.verifyTotpCode.mockResolvedValue(undefined);
    const { result } = renderHook(() => useVerifyTotp());
    await act(() => result.current.submit({ code: '123456' }));
    expect(page.loadPage).toHaveBeenCalledWith('/');
    expect(cookieAtNavigation).toBeUndefined();
  });

  it('keeps the style when the second-factor code is refused', async () => {
    calls.verifyTotpCode.mockResolvedValue('admin.codeInvalid');
    const { result } = renderHook(() => useVerifyTotp());
    await act(() => result.current.submit({ code: '123456' }));
    expect(storedStyle()).toBe('B');
    expect(page.loadPage).not.toHaveBeenCalled();
  });
});
