import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  attendanceTestClient,
  boardScope,
  boardId,
  otherBoardId,
  employeesFixture,
} from './attendance-actions.fixture';
import { useAttendanceEmployees } from './use-attendance-employees';
const api = vi.hoisted(() => ({ GET: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
beforeEach(() => api.GET.mockReset());
const cursor = JSON.stringify(['Synthetic employee', otherBoardId]);
it('uses the names-only branch route, tenant header, search and server cursor', async () => {
  api.GET.mockResolvedValue({ data: { ...employeesFixture, next_cursor: cursor } });
  const test = attendanceTestClient();
  const hook = renderHook(() => useAttendanceEmployees(boardScope, ' Synthetic '), {
    wrapper: test.wrapper,
  });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  expect(api.GET).toHaveBeenCalledWith(
    '/v1/businesses/{businessId}/branches/{branchId}/attendance-employees',
    expect.objectContaining({
      params: {
        path: { businessId: boardId, branchId: boardId },
        header: { 'x-company-id': boardId },
        query: { limit: 50, search: 'Synthetic' },
      },
      signal: expect.any(AbortSignal),
    }),
  );
  await act(() => hook.result.current.fetchNextPage());
  expect(api.GET.mock.calls.at(-1)?.[1].params.query).toEqual({
    limit: 50,
    search: 'Synthetic',
    cursor,
  });
  hook.unmount();
  test.client.clear();
});
it('starts each search at the first page and removes all search caches on unmount', async () => {
  api.GET.mockResolvedValue({ data: { ...employeesFixture, next_cursor: cursor } });
  const test = attendanceTestClient();
  const hook = renderHook(({ search }) => useAttendanceEmployees(boardScope, search), {
    initialProps: { search: '' },
    wrapper: test.wrapper,
  });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  await act(() => hook.result.current.fetchNextPage());
  api.GET.mockResolvedValue({ data: { items: [], next_cursor: null } });
  hook.rerender({ search: 'Other' });
  await waitFor(() => expect(hook.result.current.data?.pages[0]?.items).toEqual([]));
  expect(api.GET.mock.calls.at(-1)?.[1].params.query).toEqual({ limit: 50, search: 'Other' });
  expect(hook.result.current.hasNextPage).toBe(false);
  hook.unmount();
  expect(test.client.getQueryCache().getAll()).toHaveLength(0);
  test.client.clear();
});
it.each(['companyId', 'businessId', 'branchId', 'userId'] as const)(
  'isolates employee search by %s',
  async (field) => {
    api.GET.mockResolvedValue({ data: employeesFixture });
    const test = attendanceTestClient();
    const hook = renderHook(({ scope }) => useAttendanceEmployees(scope), {
      initialProps: { scope: boardScope },
      wrapper: test.wrapper,
    });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    const scope = { ...boardScope, [field]: otherBoardId };
    hook.rerender({ scope });
    await waitFor(() => expect(api.GET).toHaveBeenCalledTimes(2));
    expect(test.client.getQueryCache().getAll()).toHaveLength(1);
    expect(test.client.getQueryCache().getAll()[0]?.queryKey).toEqual([
      'attendance-actions',
      scope.companyId,
      scope.businessId,
      scope.branchId,
      scope.userId,
      'employees',
      '',
      undefined,
    ]);
    hook.unmount();
    test.client.clear();
  },
);
it('restarts pagination and isolates the employee list when the chosen date changes', async () => {
  api.GET.mockResolvedValue({ data: { ...employeesFixture, next_cursor: cursor } });
  const test = attendanceTestClient();
  const hook = renderHook(({ date }) => useAttendanceEmployees(boardScope, '', date), {
    initialProps: { date: '2026-10-10' },
    wrapper: test.wrapper,
  });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  await act(() => hook.result.current.fetchNextPage());
  expect(api.GET.mock.calls.at(-1)?.[1].params.query).toEqual({
    limit: 50,
    search: '',
    date: '2026-10-10',
    cursor,
  });
  api.GET.mockResolvedValue({ data: { items: [], next_cursor: null } });
  hook.rerender({ date: '2026-10-11' });
  await waitFor(() => expect(hook.result.current.data?.pages[0]?.items).toEqual([]));
  expect(api.GET.mock.calls.at(-1)?.[1].params.query).toEqual({
    limit: 50,
    search: '',
    date: '2026-10-11',
  });
  expect(hook.result.current.hasNextPage).toBe(false);
  expect(
    test.client
      .getQueryCache()
      .getAll()
      .map((query) => query.queryKey.at(-1)),
  ).toEqual(['2026-10-10', '2026-10-11']);
  hook.unmount();
  expect(test.client.getQueryCache().getAll()).toHaveLength(0);
  test.client.clear();
});
it.each(['NOT_FOUND', 'FORBIDDEN', 'FEATURE_DISABLED'])(
  'preserves %s and its HTTP status for the picker',
  async (code) => {
    const error = { code, message_ar: 'Synthetic AR refusal', message_en: 'Synthetic refusal' };
    api.GET.mockResolvedValue({ error, response: { status: 403 } });
    const test = attendanceTestClient();
    const hook = renderHook(() => useAttendanceEmployees(boardScope), { wrapper: test.wrapper });
    await waitFor(() => expect(hook.result.current.error).toEqual({ ...error, status: 403 }));
    hook.unmount();
    test.client.clear();
  },
);
