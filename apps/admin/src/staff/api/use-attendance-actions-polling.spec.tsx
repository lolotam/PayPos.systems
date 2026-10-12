import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  attendanceTestClient,
  boardScope,
  exceptionPage,
  requestPage,
} from './attendance-actions.fixture';
import { useAttendanceExceptions, useAttendanceRequests } from './use-attendance-actions-read';

const api = vi.hoisted(() => ({ GET: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
beforeEach(() => {
  api.GET.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it.each([
  {
    name: 'exceptions',
    useList: () => useAttendanceExceptions(boardScope, 'OPEN'),
    page: exceptionPage,
  },
  {
    name: 'requests',
    useList: () => useAttendanceRequests(boardScope, 'PENDING'),
    page: requestPage,
  },
])(
  'polls loaded $name pages every 30 seconds only in the foreground without retries',
  async ({ useList, page }) => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    api.GET.mockResolvedValue({ data: page });
    const test = attendanceTestClient();
    const hook = renderHook<
      ReturnType<typeof useAttendanceExceptions> | ReturnType<typeof useAttendanceRequests>,
      undefined
    >(() => useList(), { wrapper: test.wrapper });
    await act(() => vi.advanceTimersByTimeAsync(100));
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(hook.result.current.data?.pages).toHaveLength(1);
    await act(async () => {
      await hook.result.current.fetchNextPage();
    });
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(hook.result.current.data?.pages).toHaveLength(2);
    const initial = api.GET.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(29_000));
    expect(api.GET).toHaveBeenCalledTimes(initial);
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(api.GET).toHaveBeenCalledTimes(initial + 2);
    expect(api.GET.mock.calls.slice(-2).map((call) => call[1].params.query.cursor)).toEqual([
      undefined,
      page.next_cursor,
    ]);
    visibility.mockReturnValue('hidden');
    act(() => window.dispatchEvent(new Event('visibilitychange')));
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(api.GET).toHaveBeenCalledTimes(initial + 2);
    visibility.mockReturnValue('visible');
    act(() => window.dispatchEvent(new Event('visibilitychange')));
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(api.GET).toHaveBeenCalledTimes(initial + 4);
    api.GET.mockRejectedValue(new Error('Synthetic outage'));
    const beforeFailure = api.GET.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(api.GET).toHaveBeenCalledTimes(beforeFailure + 1);
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(api.GET).toHaveBeenCalledTimes(beforeFailure + 1);
    expect(hook.result.current.data?.pages).toHaveLength(2);
    hook.unmount();
    test.client.clear();
  },
);
