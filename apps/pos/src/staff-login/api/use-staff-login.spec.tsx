import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useStaffLogin } from './use-staff-login';

const calls = vi.hoisted(() => ({ probe: vi.fn(), signOut: vi.fn() }));
vi.mock('./staff-calls', () => ({
  probeStaffSession: calls.probe,
  signOutStaff: calls.signOut,
}));

function display() {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={cache}>{children}</QueryClientProvider>
  );
  return { cache, ...renderHook(useStaffLogin, { wrapper }) };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  vi.stubGlobal('BroadcastChannel', undefined);
  calls.probe.mockResolvedValue({
    user_id: 'synthetic-operator',
    expires_at: 'synthetic-deadline',
  });
  calls.signOut.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

it('offline removes private state and reconnect requires a fresh server proof before exposing staff', async () => {
  const h = display();
  await waitFor(() => expect(h.result.current.session?.user_id).toBe('synthetic-operator'));
  h.cache.setQueryData(['private-sales'], { owner: 'synthetic-operator' });
  act(() => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    window.dispatchEvent(new Event('offline'));
  });
  expect(h.result.current.session).toBeNull();
  expect(h.cache.getQueryData(['private-sales'])).toBeUndefined();
  let resolve: (value: null) => void = () => undefined;
  calls.probe.mockImplementation(
    () =>
      new Promise<null>((done) => {
        resolve = done;
      }),
  );
  act(() => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    window.dispatchEvent(new Event('online'));
  });
  await waitFor(() => expect(calls.probe).toHaveBeenCalledTimes(2));
  expect(h.result.current.session).toBeNull();
  await act(async () => {
    resolve(null);
  });
  await waitFor(() => expect(h.result.current.loading).toBe(false));
  expect(h.result.current.session).toBeNull();
});

it('operator replacement clears every tab cache before its fresh probe resolves', async () => {
  const first = display(),
    second = display();
  await waitFor(() => expect(first.result.current.session).not.toBeNull());
  await waitFor(() => expect(second.result.current.session).not.toBeNull());
  first.cache.setQueryData(['private-sales'], 'synthetic-private');
  second.cache.setQueryData(['private-sales'], 'synthetic-private');
  calls.probe.mockResolvedValue(null);
  act(() =>
    window.dispatchEvent(new StorageEvent('storage', { key: 'pospay-staff-operator-change' })),
  );
  expect(first.cache.getQueryData(['private-sales'])).toBeUndefined();
  expect(second.cache.getQueryData(['private-sales'])).toBeUndefined();
  await waitFor(() => expect(first.result.current.session).toBeNull());
  await waitFor(() => expect(second.result.current.session).toBeNull());
});

it('revocation on the next probe removes private queries and exposes no previous operator', async () => {
  const h = display();
  await waitFor(() => expect(h.result.current.session).not.toBeNull());
  h.cache.setQueryData(['private-sales'], 'synthetic-private');
  calls.probe.mockRejectedValue(new Error('STAFF_REFUSED'));
  await act(async () => {
    await h.cache.invalidateQueries({ queryKey: ['staff-session'] });
  });
  await waitFor(() => expect(h.cache.getQueryData(['private-sales'])).toBeUndefined());
  expect(h.result.current.session).toBeNull();
});

it('acknowledged logout clears local private data and announces only a structural tab signal', async () => {
  const h = display();
  await waitFor(() => expect(h.result.current.session).not.toBeNull());
  h.cache.setQueryData(['private-sales'], 'synthetic-private');
  calls.probe.mockResolvedValue(null);
  await act(async () => {
    await h.result.current.signOut();
  });
  expect(calls.signOut).toHaveBeenCalledOnce();
  expect(h.cache.getQueryData(['private-sales'])).toBeUndefined();
  expect(localStorage.getItem('pospay-staff-operator-change')).toMatch(/^\d+$/);
  expect(h.result.current.session).toBeNull();
});

it('keeps an authenticated operator during a background probe and removes it on expiry', async () => {
  const h = display();
  await waitFor(() =>
    expect(h.result.current.authenticatedSession?.user_id).toBe('synthetic-operator'),
  );
  let finish: ((value: null) => void) | undefined;
  calls.probe.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  let refresh: Promise<void> | undefined;
  act(() => {
    refresh = h.cache.invalidateQueries({ queryKey: ['staff-session'] });
  });
  await waitFor(() => expect(h.result.current.session).toBeNull());
  expect(h.result.current.authenticatedSession?.user_id).toBe('synthetic-operator');
  await act(async () => {
    finish?.(null);
    await refresh;
  });
  await waitFor(() => expect(h.result.current.authenticatedSession).toBeNull());
});
