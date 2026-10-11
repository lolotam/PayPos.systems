import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  attendanceTestClient,
  boardScope,
  boardId,
  exceptionPage,
  historyFixture,
  requestPage,
  employeesFixture,
} from './attendance-actions.fixture';
import {
  useAttendanceExceptions,
  useAttendanceHistory,
  useAttendanceRequests,
} from './use-attendance-actions-read';
import { useAttendanceEmployees } from './use-attendance-employees';
const api = vi.hoisted(() => ({ GET: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
beforeEach(() => api.GET.mockReset());
it.each(['OPEN', 'RESOLVED'] as const)(
  'reads and pages %s exceptions with branch/user isolation',
  async (status) => {
    api.GET.mockResolvedValue({ data: exceptionPage });
    const test = attendanceTestClient();
    const hook = renderHook(() => useAttendanceExceptions(boardScope, status), {
      wrapper: test.wrapper,
    });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    expect(api.GET).toHaveBeenCalledWith(
      '/v1/businesses/{businessId}/branches/{branchId}/attendance-exceptions',
      expect.objectContaining({
        params: {
          path: { businessId: boardId, branchId: boardId },
          header: { 'x-company-id': boardId },
          query: { status, limit: 50 },
        },
        signal: expect.any(AbortSignal),
      }),
    );
    await act(() => hook.result.current.fetchNextPage());
    expect(api.GET.mock.calls.at(-1)?.[1].params.query.cursor).toBe(exceptionPage.next_cursor);
    expect(test.client.getQueryCache().getAll()[0]?.queryKey).toContain(boardScope.userId);
    hook.unmount();
    test.client.clear();
  },
);
it('reads session history from the 27d-1 route', async () => {
  api.GET.mockResolvedValue({ data: historyFixture });
  const test = attendanceTestClient();
  const hook = renderHook(() => useAttendanceHistory(boardScope, boardId), {
    wrapper: test.wrapper,
  });
  await waitFor(() => expect(hook.result.current.data).toEqual(historyFixture));
  expect(api.GET).toHaveBeenCalledWith(
    '/v1/businesses/{businessId}/branches/{branchId}/attendance-sessions/{sessionId}/corrections',
    expect.objectContaining({
      params: {
        path: { businessId: boardId, branchId: boardId, sessionId: boardId },
        header: { 'x-company-id': boardId },
      },
    }),
  );
  hook.unmount();
  test.client.clear();
});
it('reads scoped requests, pages by cursor and lets the server supply action flags', async () => {
  api.GET.mockResolvedValue({ data: requestPage });
  const test = attendanceTestClient();
  const hook = renderHook(() => useAttendanceRequests(boardScope, 'PENDING'), {
    wrapper: test.wrapper,
  });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  expect(api.GET.mock.calls[0]?.[0]).toBe('/v1/businesses/{businessId}/attendance-change-requests');
  expect(api.GET.mock.calls[0]?.[1].params.query).toEqual({
    branch_id: boardId,
    limit: 50,
    status: 'PENDING',
  });
  await act(() => hook.result.current.fetchNextPage());
  expect(api.GET.mock.calls.at(-1)?.[1].params.query.cursor).toBe(requestPage.next_cursor);
  hook.unmount();
  test.client.clear();
});
it('pages the employee picker using the existing directory route', async () => {
  api.GET.mockResolvedValue({ data: { ...employeesFixture, next_cursor: 'employees-next' } });
  const test = attendanceTestClient();
  const hook = renderHook(() => useAttendanceEmployees(boardScope), { wrapper: test.wrapper });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  await act(() => hook.result.current.fetchNextPage());
  expect(api.GET.mock.calls.at(-1)?.[0]).toBe('/v1/businesses/{businessId}/employees');
  expect(api.GET.mock.calls.at(-1)?.[1].params.query).toEqual({
    limit: 50,
    cursor: 'employees-next',
  });
  hook.unmount();
  test.client.clear();
});
it('preserves the refusal envelope and HTTP status', async () => {
  api.GET.mockResolvedValue({
    error: { code: 'NOT_FOUND', message_en: 'Synthetic refusal' },
    response: { status: 404 },
  });
  const test = attendanceTestClient();
  const hook = renderHook(() => useAttendanceExceptions(boardScope, 'OPEN'), {
    wrapper: test.wrapper,
  });
  await waitFor(() =>
    expect(hook.result.current.error).toMatchObject({ code: 'NOT_FOUND', status: 404 }),
  );
  hook.unmount();
  test.client.clear();
});
