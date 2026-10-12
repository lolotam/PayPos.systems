import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { boardFixture, boardScope, refusalFixture } from './attendance-board.fixture';
import { useAttendanceBoard } from './use-attendance-board';
const api = vi.hoisted(() => ({ GET: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
beforeEach(() => {
  api.GET.mockReset();
  api.GET.mockImplementation(async (path: string) => ({
    data: path.endsWith('refusals') ? refusalFixture : boardFixture,
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function setup(date?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useAttendanceBoard(boardScope, date), { wrapper });
  return { client, ...hook };
}
it('uses scoped generated client, lets the server choose today, paginates and evicts on close', async () => {
  const hook = setup();
  await waitFor(() => expect(hook.result.current.refusals.data?.pages).toHaveLength(1));
  expect(api.GET.mock.calls[0]?.[1]).toMatchObject({
    params: {
      header: { 'x-company-id': boardScope.companyId },
      path: { businessId: boardScope.businessId, branchId: boardScope.branchId },
      query: {},
    },
    signal: expect.any(AbortSignal),
  });
  await act(async () => {
    await hook.result.current.refusals.fetchNextPage();
  });
  expect(api.GET.mock.calls.at(-1)?.[1].params.query).toEqual({
    limit: 50,
    cursor: refusalFixture.next_cursor,
  });
  hook.unmount();
  expect(hook.client.getQueryCache().findAll({ queryKey: ['attendance-board'] })).toEqual([]);
  hook.client.clear();
});
it('sends a selected working date and keeps the last successful response after a failed refresh', async () => {
  const hook = setup('2026-10-09');
  await waitFor(() => expect(hook.result.current.board.data).toEqual(boardFixture));
  expect(api.GET.mock.calls[0]?.[1].params.query).toEqual({ date: '2026-10-09' });
  api.GET.mockRejectedValue(new Error('Synthetic outage'));
  await act(async () => {
    await hook.result.current.board.refetch();
  });
  expect(hook.result.current.board.data).toEqual(boardFixture);
  await waitFor(() => expect(hook.result.current.board.isError).toBe(true));
  hook.unmount();
  hook.client.clear();
});
it('polls both endpoints every 30 seconds and pauses while the tab is hidden', async () => {
  vi.useFakeTimers();
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const hook = setup();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  expect(hook.result.current.refusals.data?.pages).toHaveLength(1);
  const initial = api.GET.mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });
  expect(api.GET.mock.calls.length).toBe(initial + 2);
  visibility.mockReturnValue('hidden');
  act(() => window.dispatchEvent(new Event('visibilitychange')));
  const hiddenCalls = api.GET.mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(api.GET.mock.calls.length).toBe(hiddenCalls);
  visibility.mockReturnValue('visible');
  act(() => window.dispatchEvent(new Event('visibilitychange')));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  expect(api.GET.mock.calls.length).toBeGreaterThan(hiddenCalls);
  hook.unmount();
  hook.client.clear();
});
it('does not query refusals when the board is denied', async () => {
  api.GET.mockResolvedValue({ error: { code: 'NOT_FOUND' }, response: { status: 404 } });
  const hook = setup();
  await waitFor(() => expect(hook.result.current.board.isError).toBe(true));
  expect(api.GET).toHaveBeenCalledTimes(1);
  hook.unmount();
  hook.client.clear();
});
