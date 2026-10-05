import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { usePersonalSession } from './use-personal-session';
import { personalCalls } from './personal-calls';
import { observePersonalChange, announcePersonalChange } from '../model/session-change';
vi.mock('./personal-calls', () => ({ personalCalls: { session: vi.fn(), signOut: vi.fn() } }));
vi.mock('../model/session-change', () => ({
  observePersonalChange: vi.fn(() => () => undefined),
  announcePersonalChange: vi.fn(),
}));
const session = {
  user_id: 'user',
  employee_id: 'employee',
  company_id: 'company',
  business_id: 'business',
  expires_at: '2026-10-04T12:00:00Z',
};
function fixture() {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={cache}>{children}</QueryClientProvider>
  );
  return { cache, ...renderHook(() => usePersonalSession(), { wrapper }) };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(personalCalls.session).mockResolvedValue(session);
  vi.mocked(personalCalls.signOut).mockResolvedValue(undefined);
});
it('logout and cross-tab replacement remove prior personal cache data', async () => {
  const f = fixture();
  await waitFor(() => expect(f.result.current.session).toEqual(session));
  f.cache.setQueryData(['personal-binding', 'employee'], { private: true });
  vi.mocked(personalCalls.session).mockResolvedValue(null);
  await act(async () => {
    await f.result.current.signOut();
  });
  expect(f.cache.getQueryData(['personal-binding', 'employee'])).toBeUndefined();
  expect(announcePersonalChange).toHaveBeenCalled();
  f.cache.setQueryData(['personal-binding', 'employee'], { private: true });
  const change = vi.mocked(observePersonalChange).mock.calls[0]?.[0];
  act(() => change?.());
  expect(f.cache.getQueryData(['personal-binding', 'employee'])).toBeUndefined();
  f.unmount();
});
it('a revoked session or offline transition hides prior data and clears private queries', async () => {
  const f = fixture();
  await waitFor(() => expect(f.result.current.session).toEqual(session));
  f.cache.setQueryData(['personal-binding', 'employee'], { private: true });
  vi.mocked(personalCalls.session).mockResolvedValue(null);
  await act(async () => {
    await f.cache.invalidateQueries({ queryKey: ['personal-session'] });
  });
  await waitFor(() =>
    expect(f.cache.getQueryData(['personal-binding', 'employee'])).toBeUndefined(),
  );
  act(() => window.dispatchEvent(new Event('offline')));
  expect(f.result.current.session).toBeNull();
  f.unmount();
});
