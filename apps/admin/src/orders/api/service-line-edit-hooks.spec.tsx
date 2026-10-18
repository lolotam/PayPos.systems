import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { id, scope } from '../model/session-recording-result.fixture';
import { useBranchDaySessions } from './use-branch-day-sessions';
import { useEditServiceLine } from './use-edit-service-line';
import { useLineEditHistory } from './use-line-edit-history';

const state = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: state.get, PATCH: state.patch }) }));
const day = '/v1/businesses/{businessId}/branches/{branchId}/service-sessions';
const edits = '/v1/businesses/{businessId}/branches/{branchId}/service-sessions/{sessionId}/lines/{lineId}/edits';
function wrap() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}
const body = { price: '10.000', discount: { kind: 'AMOUNT' as const, amount: '1.000' }, reason: 'fix', expected_revision: 1 };

it('pages the day list with scope in the key and omits late until asked', async () => {
  state.get.mockReset();
  state.get.mockResolvedValueOnce({ data: { items: [], next_cursor: 'page2' }, response: { status: 200 } }).mockResolvedValue({ data: { items: [], next_cursor: null }, response: { status: 200 } });
  const { client, wrapper } = wrap();
  const hook = renderHook(() => useBranchDaySessions(scope, '2026-10-13', false, true), { wrapper });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  await act(async () => { await hook.result.current.fetchNextPage(); });
  expect(state.get.mock.calls.map((call) => call[1].params.query)).toEqual([{ date: '2026-10-13', limit: 20 }, { date: '2026-10-13', limit: 20, cursor: 'page2' }]);
  expect(client.getQueryCache().getAll().at(-1)?.queryKey).toEqual(['branch-day-sessions', scope.companyId, scope.businessId, scope.branchId, scope.userId, '2026-10-13', false]);
  expect(state.get.mock.calls[0]?.[0]).toBe(day);
  hook.unmount(); state.get.mockClear();
  renderHook(() => useBranchDaySessions(scope, '2026-10-13', true, true), { wrapper });
  await waitFor(() => expect(state.get.mock.lastCall?.[1].params.query).toEqual({ date: '2026-10-13', limit: 20, late: 'true' }));
});

it('reads edit history only while the panel is open and follows the cursor', async () => {
  state.get.mockReset();
  state.get.mockResolvedValueOnce({ data: { items: [], next_cursor: 'next' }, response: { status: 200 } }).mockResolvedValue({ data: { items: [], next_cursor: null }, response: { status: 200 } });
  const { wrapper } = wrap();
  const hook = renderHook(({ enabled }) => {
    const history = useLineEditHistory(scope, id(12), id(11), enabled);
    // data لازم تتقرأ أثناء الرسم، وإلا TanStack مش بيبلغ لما الصفحة التانية توصل
    return { pages: history.data?.pages.length ?? 0, history };
  }, { wrapper, initialProps: { enabled: false } });
  expect(state.get).not.toHaveBeenCalled();
  hook.rerender({ enabled: true });
  await waitFor(() => expect(hook.result.current.history.isSuccess).toBe(true));
  await act(async () => { await hook.result.current.history.fetchNextPage(); });
  await waitFor(() => expect(hook.result.current.pages).toBe(2));
  expect(state.get.mock.calls.map((call) => [call[0], call[1].params.query])).toEqual([[edits, { limit: 50 }], [edits, { limit: 50, cursor: 'next' }]]);
});

it('reuses one idempotency key after a network failure and renews it after success or a new body', async () => {
  state.patch.mockReset();
  let n = 40;
  const keys = vi.spyOn(crypto, 'randomUUID').mockImplementation(() => id(n++) as ReturnType<typeof crypto.randomUUID>);
  state.patch.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ data: { saved: true, edited: true }, response: { status: 200 } });
  const { client, wrapper } = wrap();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const hook = renderHook(() => useEditServiceLine(scope), { wrapper });
  const attempt = { sessionId: id(12), lineId: id(11), body };
  await act(async () => { await hook.result.current.mutateAsync(attempt).catch(() => undefined); });
  await act(async () => { await hook.result.current.mutateAsync(attempt); });
  const header = (call: { 1: { params: { header: { 'Idempotency-Key': string } } } }) => call[1].params.header['Idempotency-Key'];
  expect(header(state.patch.mock.calls[0] as never)).toBe(header(state.patch.mock.calls[1] as never));
  await act(async () => { await hook.result.current.mutateAsync(attempt); });
  await act(async () => { await hook.result.current.mutateAsync({ ...attempt, body: { ...body, price: '11.000' } }); });
  const sent = state.patch.mock.calls.map((call) => header(call as never));
  expect(sent[2]).not.toBe(sent[1]);
  expect(sent[3]).not.toBe(sent[2]);
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['branch-day-sessions', scope.companyId, scope.businessId, scope.branchId, scope.userId] });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['service-line-edits', scope.companyId, scope.businessId, scope.branchId, scope.userId, id(12), id(11)] });
  keys.mockRestore();
});
