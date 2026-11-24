import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { QueryProvider } from '@/shared/api/query-provider';

import { useSignIn } from './use-sign-in';
import { useSignOut } from './use-sign-out';
import { useVerifyTotp } from './use-verify-totp';

const loadPage = vi.fn();
const announce = vi.fn();
const push = vi.fn();
const calls = {
  signInWithPassword: vi.fn(),
  signOutSession: vi.fn(),
  verifyTotpCode: vi.fn(),
};

vi.mock('@/shared/browser/load-page', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadPage: (path: string) => loadPage(path),
  announceIdentityChange: () => announce(),
}));
// دخولك بيقري تفضيل الحساب قبل الانتقال؛ الـ mock يحسم القراءة بـ null بدل نداء شبكة حقيقي.
vi.mock('@/shared/api/client', () => ({
  apiClient: () => ({
    GET: () =>
      Promise.resolve({ data: { navStyle: null }, error: undefined, response: { ok: true } }),
  }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock('./session-calls', () => ({
  signInWithPassword: (...args: unknown[]) => calls.signInWithPassword(...args),
  signOutSession: () => calls.signOutSession(),
  verifyTotpCode: (...args: unknown[]) => calls.verifyTotpCode(...args),
}));

const SIGN_IN = { email: 'a@example.test', password: 'x' };

/** مجسّ الكاش الحقيقي داخل QueryProvider: يزرع بيانات المستخدم السابق ثم يسجّل الدخول من نفس الشجرة. */
function CacheProbe() {
  const client = useQueryClient();
  const { submit } = useSignIn();
  const [cached, setCached] = useState<string | undefined>();
  return (
    <>
      <button
        type="button"
        onClick={() => {
          client.setQueryData(['probe', 'inbox'], 'Previous user session data');
          setCached(String(client.getQueryData(['probe', 'inbox'])));
        }}
      >
        Seed
      </button>
      <button type="button" onClick={() => void submit(SIGN_IN)}>
        Go
      </button>
      <p>Cached: {cached ?? 'empty'}</p>
    </>
  );
}

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
    await act(() => result.current.submit(SIGN_IN));
    expect(loadPage).toHaveBeenCalledExactlyOnceWith('/');
    expect(push).not.toHaveBeenCalled();
  });

  it('a sign-in that needs TOTP stays client-side: the user has not changed yet', async () => {
    calls.signInWithPassword.mockResolvedValue('totp');
    const { result } = renderHook(() => useSignIn());
    await act(() => result.current.submit(SIGN_IN));
    expect(push).toHaveBeenCalledExactlyOnceWith('/login/two-factor');
    expect(loadPage).not.toHaveBeenCalled();
  });

  it('a verified TOTP code loads /', async () => {
    calls.verifyTotpCode.mockResolvedValue(undefined);
    const { result } = renderHook(() => useVerifyTotp());
    await act(() => result.current.submit({ code: '123456' }));
    expect(loadPage).toHaveBeenCalledExactlyOnceWith('/');
  });

  it('a real QueryProvider keeps the cache and does not reload the tab that signs in', async () => {
    calls.signInWithPassword.mockResolvedValue('done');
    const reload = vi.fn();
    const assign = vi.fn();
    vi.stubGlobal('location', { assign, reload });
    render(
      <QueryProvider>
        <CacheProbe />
      </QueryProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Seed' }));
    expect(screen.getByText('Cached: Previous user session data')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    await waitFor(() => expect(loadPage).toHaveBeenCalledTimes(1));
    expect(loadPage).toHaveBeenCalledExactlyOnceWith('/');
    expect(reload).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByText('Cached: Previous user session data')).toBeTruthy();
  });
});
