import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useSessionServices } from './use-session-services';
const state = vi.hoisted(() => ({ get: vi.fn(), locale: 'en' as 'ar' | 'en' }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: state.get }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));
const scope = { companyId: 'company', businessId: 'business', branchId: 'branch', userId: 'actor' };
function setup(search = '', enabled = true) {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, ...renderHook(({ place, q }) => useSessionServices(place, q, enabled), { wrapper, initialProps: { place: scope, q: search } }) };
}
it('sends UI language, trimmed search and the opaque cursor with an abort signal', async () => {
  state.get.mockReset(); state.locale = 'ar';
  state.get.mockResolvedValueOnce({ data: { items: [], next_cursor: 'opaque' } }).mockResolvedValue({ data: { items: [], next_cursor: null } });
  const hook = setup('  Synthetic  '); await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  await act(async () => { await hook.result.current.fetchNextPage(); });
  expect(state.get.mock.calls.map((call) => call[1].params.query)).toEqual([
    { lang: 'ar', q: 'Synthetic', limit: 20 }, { lang: 'ar', q: 'Synthetic', limit: 20, cursor: 'opaque' },
  ]);
  expect(state.get.mock.lastCall).toEqual(['/v1/businesses/{businessId}/branches/{branchId}/service-sessions/service-options', {
    params: { header: { 'x-company-id': 'company' }, path: { businessId: 'business', branchId: 'branch' }, query: { lang: 'ar', q: 'Synthetic', limit: 20, cursor: 'opaque' } }, signal: expect.any(AbortSignal),
  }]);
  state.locale = 'en'; hook.rerender({ place: scope, q: ' ' });
  await waitFor(() => expect(state.get.mock.lastCall?.[1].params.query).toEqual({ lang: 'en', limit: 20 }));
  hook.rerender({ place: { ...scope, branchId: 'replacement', userId: 'other' }, q: 'changed' });
  await waitFor(() => expect(state.get.mock.lastCall?.[1].params.path.branchId).toBe('replacement'));
  expect(hook.client.getQueryCache().getAll().at(-1)?.queryKey).toEqual(['session-services', 'company', 'business', 'replacement', 'other', 'en', 'changed']);
});
it('retains HTTP refusal details without retry and disables fresh reads when requested', async () => {
  state.get.mockReset(); const error = { code: 'FORBIDDEN', message_ar: 'Refusal AR', message_en: 'Refusal EN' };
  state.get.mockResolvedValue({ error, response: { status: 403 } });
  const hook = setup(); await waitFor(() => expect(hook.result.current.error).toEqual({ ...error, status: 403 }));
  expect(state.get).toHaveBeenCalledTimes(1); hook.unmount(); state.get.mockClear(); setup('', false);
  expect(state.get).not.toHaveBeenCalled();
});
it('rejects malformed option pages', async () => {
  state.get.mockResolvedValue({ data: { items: [{ price: 7.125 }], next_cursor: null } });
  const hook = setup(); await waitFor(() => expect(hook.result.current.isError).toBe(true));
});
it('reports invalid search text without crashing the editor or sending HTTP', async () => {
  state.get.mockClear(); const hook = setup('bad\u0000search');
  await waitFor(() => expect(hook.result.current.isError).toBe(true)); expect(state.get).not.toHaveBeenCalled();
});
