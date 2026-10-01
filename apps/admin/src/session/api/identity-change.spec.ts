import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSignIn } from './use-sign-in';
import { useSignOut } from './use-sign-out';
import { useVerifyTotp } from './use-verify-totp';

const loadPage = vi.fn();
const push = vi.fn();
const calls = {
  signInWithPassword: vi.fn(),
  signOutSession: vi.fn(),
  verifyTotpCode: vi.fn(),
};

vi.mock('@/shared/browser/load-page', () => ({ loadPage: (path: string) => loadPage(path) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock('./session-calls', () => ({
  signInWithPassword: (...args: unknown[]) => calls.signInWithPassword(...args),
  signOutSession: () => calls.signOutSession(),
  verifyTotpCode: (...args: unknown[]) => calls.verifyTotpCode(...args),
}));

// The previous user's cached queries must not reach the next one: every identity change is a full page load.
describe('identity changes reload the page', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sign-out loads /login after the API confirms', async () => {
    calls.signOutSession.mockResolvedValue(true);
    const { result } = renderHook(() => useSignOut());
    await act(() => result.current.submit());
    expect(loadPage).toHaveBeenCalledExactlyOnceWith('/login');
  });

  it('a failed sign-out stays on the page', async () => {
    calls.signOutSession.mockResolvedValue(false);
    const { result } = renderHook(() => useSignOut());
    await act(() => result.current.submit());
    expect(loadPage).not.toHaveBeenCalled();
    expect(result.current.failed).toBe(true);
  });

  it('a completed sign-in loads / instead of a client push', async () => {
    calls.signInWithPassword.mockResolvedValue('done');
    const { result } = renderHook(() => useSignIn());
    await act(() => result.current.submit({ email: 'a@example.test', password: 'x' }));
    expect(loadPage).toHaveBeenCalledExactlyOnceWith('/');
    expect(push).not.toHaveBeenCalled();
  });

  it('a sign-in that needs TOTP stays client-side: the user has not changed yet', async () => {
    calls.signInWithPassword.mockResolvedValue('totp');
    const { result } = renderHook(() => useSignIn());
    await act(() => result.current.submit({ email: 'a@example.test', password: 'x' }));
    expect(push).toHaveBeenCalledExactlyOnceWith('/login/two-factor');
    expect(loadPage).not.toHaveBeenCalled();
  });

  it('a verified TOTP code loads /', async () => {
    calls.verifyTotpCode.mockResolvedValue(undefined);
    const { result } = renderHook(() => useVerifyTotp());
    await act(() => result.current.submit({ code: '123456' }));
    expect(loadPage).toHaveBeenCalledExactlyOnceWith('/');
  });
});
