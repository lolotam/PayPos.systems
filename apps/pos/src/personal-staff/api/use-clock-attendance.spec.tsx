import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { attendanceCalls } from './attendance-calls';
import { useClockAttendance } from './use-clock-attendance';
vi.mock('./attendance-calls', () => ({
  attendanceCalls: { clock: vi.fn() },
  attendancePosition: vi.fn(async () => undefined),
}));
const qr = JSON.stringify({ branch_id: 'synthetic', window: 1, sig: 'ab'.repeat(32) });
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());
it('an offline scan leaves the camera and shows a retryable failure without any request', async () => {
  vi.stubGlobal('navigator', { ...navigator, onLine: false });
  const { result } = renderHook(() => useClockAttendance());
  act(() => result.current.start());
  await act(() => result.current.scanned(qr));
  expect(result.current).toMatchObject({ scanning: false, pending: false, error: true });
  expect(attendanceCalls.clock).not.toHaveBeenCalled();
});
it('a malformed QR is a failure, never a request', async () => {
  const { result } = renderHook(() => useClockAttendance());
  await act(() => result.current.scanned('not-a-token'));
  expect(result.current).toMatchObject({ pending: false, error: true, result: null });
  expect(attendanceCalls.clock).not.toHaveBeenCalled();
});
