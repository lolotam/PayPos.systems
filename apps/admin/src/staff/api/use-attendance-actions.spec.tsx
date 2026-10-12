import type { AttendanceChangeRequestInput } from '@pospay/contracts';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  attendanceTestClient,
  boardScope,
  boardId,
  otherBoardId,
  exceptionRecord,
  requestRecord,
  correctionResult,
} from './attendance-actions.fixture';
import { useAttendanceActions } from './use-attendance-actions';
import { attendanceUtc } from '../model/attendance-local-time';
const api = vi.hoisted(() => ({ POST: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
beforeEach(() => api.POST.mockReset());
function setup() {
  const test = attendanceTestClient();
  const hook = renderHook(() => useAttendanceActions(boardScope), { wrapper: test.wrapper });
  return {
    ...test,
    ...hook,
    close: () => {
      hook.unmount();
      test.client.clear();
    },
  };
}
function expectWrite(path: string, body: unknown) {
  const [url, options] = api.POST.mock.calls.at(-1) ?? [];
  expect(url).toBe(path);
  expect(options.params.header).toMatchObject({
    'x-company-id': boardId,
    'Idempotency-Key': expect.stringMatching(/^[0-9a-f-]{36}$/),
  });
  expect(options.params.path.businessId).toBe(boardId);
  expect(options.body).toEqual(body);
}
it.each(['resolve', 'reopen'] as const)(
  'sends %s with reason, revision and required headers',
  async (action) => {
    api.POST.mockResolvedValue({ data: exceptionRecord });
    const hook = setup();
    await act(() =>
      hook.result.current.exception.mutateAsync({
        id: boardId,
        action,
        input: { revision: 3, reason: ' Synthetic reason ' },
      }),
    );
    expectWrite(`/v1/businesses/{businessId}/attendance-exceptions/{exceptionId}/${action}`, {
      revision: 3,
      reason: 'Synthetic reason',
    });
    expect(api.POST.mock.calls[0]?.[1].params.path.exceptionId).toBe(boardId);
    hook.close();
  },
);
it.each([
  [
    'Asia/Kuwait',
    '2026-10-10T23:30',
    '2026-10-11T01:30',
    '2026-10-10T20:30:00.000Z',
    '2026-10-10T22:30:00.000Z',
  ],
  [
    'America/New_York',
    '2026-07-12T23:30',
    '2026-07-13T01:30',
    '2026-07-13T03:30:00.000Z',
    '2026-07-13T05:30:00.000Z',
  ],
])(
  'sends both correction times across local midnight in %s and refetches affected reads',
  async (zone, from, to, clockIn, clockOut) => {
    api.POST.mockResolvedValue({ data: correctionResult });
    const hook = setup();
    const invalidate = vi.spyOn(hook.client, 'invalidateQueries');
    await act(() =>
      hook.result.current.correct.mutateAsync({
        id: boardId,
        input: {
          revision: 1,
          reason: ' Synthetic correction ',
          clock_in: attendanceUtc(from, zone),
          clock_out: attendanceUtc(to, zone),
        },
      }),
    );
    expectWrite('/v1/businesses/{businessId}/attendance-sessions/{sessionId}/correct', {
      revision: 1,
      reason: 'Synthetic correction',
      clock_in: clockIn,
      clock_out: clockOut,
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['attendance-board', boardId, boardId] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['attendance-actions', boardId, boardId] });
    hook.close();
  },
);
it.each(['ADD_SESSION', 'VOID_SESSION', 'RESTORE_SESSION'] as const)(
  'files %s with exactly the kind fields',
  async (kind) => {
    api.POST.mockResolvedValue({ data: requestRecord });
    const hook = setup();
    const input: AttendanceChangeRequestInput =
      kind === 'ADD_SESSION'
        ? {
            kind,
            employee_id: otherBoardId,
            branch_id: boardId,
            reason: 'Synthetic reason',
            clock_in: attendanceUtc('2026-10-11T00:30', 'Asia/Kuwait') ?? '',
            clock_out: attendanceUtc('2026-10-11T03:30', 'Asia/Kuwait') ?? '',
          }
        : {
            kind,
            employee_id: otherBoardId,
            session_id: boardId,
            session_revision: 4,
            reason: 'Synthetic reason',
          };
    await act(() => hook.result.current.request.mutateAsync(input));
    expectWrite('/v1/businesses/{businessId}/attendance-change-requests', input);
    hook.close();
  },
);
it.each(['APPROVED', 'REJECTED'] as const)(
  'decides %s with the current request revision',
  async (decision) => {
    api.POST.mockResolvedValue({ data: { ...requestRecord, effect: null } });
    const hook = setup();
    const input =
      decision === 'REJECTED'
        ? { decision, revision: 2, reason: 'Synthetic rejection' }
        : { decision, revision: 2 };
    await act(() => hook.result.current.decide.mutateAsync({ id: boardId, input }));
    expectWrite('/v1/businesses/{businessId}/attendance-change-requests/{requestId}/decide', input);
    hook.close();
  },
);
it('withdraws using cancel with revision and a fresh idempotency key', async () => {
  api.POST.mockResolvedValue({ data: requestRecord });
  const hook = setup();
  await act(() => hook.result.current.cancel.mutateAsync({ id: boardId, input: { revision: 2 } }));
  expectWrite('/v1/businesses/{businessId}/attendance-change-requests/{requestId}/cancel', {
    revision: 2,
  });
  const key = api.POST.mock.calls[0]?.[1].params.header['Idempotency-Key'];
  await act(() => hook.result.current.cancel.mutateAsync({ id: boardId, input: { revision: 2 } }));
  expect(api.POST.mock.calls[1]?.[1].params.header['Idempotency-Key']).not.toBe(key);
  hook.close();
});
it('keeps a 422 refusal intact and does not invalidate on failure', async () => {
  const refusal = {
    code: 'ATTENDANCE_CORRECTION_INVALID_TIMES',
    message_ar: 'Synthetic ar refusal',
    message_en: 'Synthetic overlap refusal',
  };
  api.POST.mockResolvedValue({ error: refusal, response: { status: 422 } });
  const hook = setup();
  const invalidate = vi.spyOn(hook.client, 'invalidateQueries');
  await act(async () => {
    await expect(
      hook.result.current.correct.mutateAsync({
        id: boardId,
        input: { revision: 1, reason: 'Synthetic reason', clock_out: '2026-10-11T01:00:00Z' },
      }),
    ).rejects.toMatchObject({ ...refusal, status: 422 });
  });
  await waitFor(() => expect(hook.result.current.correct.isError).toBe(true));
  expect(invalidate).not.toHaveBeenCalled();
  hook.close();
});
