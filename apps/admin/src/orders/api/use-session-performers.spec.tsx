import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useSessionPerformers } from './use-session-performers';
const state = vi.hoisted(() => ({ get: vi.fn(), locale: 'en' as 'ar' | 'en' }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: state.get }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));
const scope = { companyId: 'company', businessId: 'business', branchId: 'branch', userId: 'actor' };
const instant = '2026-10-13T08:00:00.000Z';
it('binds pages to language/search/scope/instant, aborts obsolete requests and rejects late results', async () => {
  let finish: (value: unknown) => void = () => {}; const client = new QueryClient(); state.get.mockReset();
  state.get.mockImplementation((path, options) => path.endsWith('/recording-context') ? Promise.resolve({ data: {
    generated_at: instant, business_timezone: 'Asia/Kuwait', recorder_membership_ids: ['01920000-0000-7000-8000-0000000000a1', '01920000-0000-7000-8000-0000000000a2'], recorder_membership_id: null, discount_limit: null } })
    : options.params.query.occurred_at === instant ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve({ data: { items: [], next_cursor: 'next' } }));
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(({ place, at, q }) => useSessionPerformers(place, at, q), { wrapper, initialProps: { place: scope, at: 'now', q: '' } });
  await waitFor(() => expect(state.get.mock.lastCall?.[1].params.query.occurred_at).toBe(instant));
  const signal = state.get.mock.lastCall?.[1].signal as AbortSignal, changed = '2026-10-12T08:00:00.000Z';
  state.locale = 'ar'; hook.rerender({ place: { ...scope, branchId: 'other', userId: 'new' }, at: changed, q: ' new ' });
  await waitFor(() => expect(hook.result.current.data).toBeDefined()); expect(signal.aborted).toBe(true);
  await act(async () => { finish({ data: { items: [], next_cursor: 'obsolete' } }); await hook.result.current.fetchNextPage(); });
  expect(state.get.mock.lastCall?.[1].params).toEqual({ header: { 'x-company-id': 'company' }, path: { businessId: 'business', branchId: 'other' },
    query: { lang: 'ar', q: 'new', occurred_at: changed, limit: 20, cursor: 'next' } });
  expect(hook.result.current.data?.pages.some((page) => page.next_cursor === 'obsolete')).toBe(false);
  hook.rerender({ place: scope, at: changed, q: 'bad\u0000search' }); expect(hook.result.current.data).toBeUndefined(); expect(hook.result.current.invalidSearch).toBe(true);
});
it('debounces rapid search, resets the cursor and isolates locale/time changes independently', async () => {
  state.locale = 'en'; state.get.mockReset(); state.get.mockResolvedValue({ data: { items: [], next_cursor: 'next' } });
  const client = new QueryClient(), wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(({ q, at }) => useSessionPerformers(scope, at, q), { wrapper, initialProps: { q: '', at: instant } });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  await act(async () => { await hook.result.current.fetchNextPage(); }); const before = state.get.mock.calls.length;
  vi.useFakeTimers();
  try {
    for (const q of ['s', 'se', 'settled']) { hook.rerender({ q, at: instant }); await act(async () => { await vi.advanceTimersByTimeAsync(100); }); }
    expect(state.get).toHaveBeenCalledTimes(before); expect(hook.result.current.data).toBeUndefined();
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(state.get.mock.lastCall?.[1].params.query).toEqual({ lang: 'en', q: 'settled', occurred_at: instant, limit: 20 });
  } finally { vi.useRealTimers(); }
  state.locale = 'ar'; hook.rerender({ q: 'settled', at: instant });
  await waitFor(() => expect(state.get.mock.lastCall?.[1].params.query.lang).toBe('ar'));
  hook.rerender({ q: 'settled', at: '2026-10-12T08:00:00.000Z' });
  await waitFor(() => expect(state.get.mock.lastCall?.[1].params.query).toMatchObject({ occurred_at: '2026-10-12T08:00:00.000Z' }));
  expect(state.get.mock.lastCall?.[1].params.query.cursor).toBeUndefined();
});
it.each([403, 'malformed'] as const)('preserves refusal details or rejects malformed pages: %s', async (status) => {
  state.get.mockReset(); const error = { message_ar: 'Refusal AR', message_en: 'Refusal EN', code: 'FORBIDDEN' };
  state.get.mockResolvedValue(status === 403 ? { error, response: { status } } : { data: { items: [{ salary: 'private' }], next_cursor: null } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
  const hook = renderHook(() => useSessionPerformers(scope, instant), { wrapper });
  await waitFor(() => expect(hook.result.current.isError).toBe(true)); expect(hook.result.current.data).toBeUndefined();
  if (status === 403) expect(hook.result.current.error).toEqual({ ...error, status });
  expect(state.get).toHaveBeenCalledTimes(2);
});
