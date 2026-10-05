import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { assertStaffAttendance } from '@pospay/auth/client';
import { attendanceCalls, attendancePosition } from './attendance-calls';
import { INSTALLATION_KEY } from '../model/installation-id';
const installation = '12345678-1234-4234-8234-123456789abc';
vi.mock('@pospay/auth/client', () => ({ assertStaffAttendance: vi.fn() }));
const fetcher = vi.fn();
const scan = { token: { branch_id: 'synthetic', window: 1, sig: 'ab'.repeat(32) } };
const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => vi.unstubAllGlobals());
it('cancellation after challenge never submits or calls generic passkey login', async () => {
  fetcher.mockResolvedValue(
    json({ challenge_id: 'synthetic', options: { challenge: 'synthetic' } }),
  );
  vi.mocked(assertStaffAttendance).mockRejectedValue(new Error('SYNTHETIC_CANCEL'));
  await expect(attendanceCalls.clock(scan)).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect((fetcher.mock.calls[0]?.[0] as Request).url).toContain('/v1/staff/attendance/challenge');
});
it('the personal generated client submits the same scan plus UV with cookies, no Device and an idempotency key', async () => {
  fetcher
    .mockResolvedValueOnce(
      json({
        challenge_id: 'synthetic',
        options: { challenge: 'synthetic', userVerification: 'required', rpId: 'localhost' },
      }),
    )
    .mockResolvedValueOnce(json({ operation: 'CLOCK_IN' }));
  vi.mocked(assertStaffAttendance).mockResolvedValue({
    id: 'synthetic',
    rawId: 'synthetic',
    type: 'public-key',
    clientExtensionResults: {},
    response: {
      clientDataJSON: 'synthetic',
      authenticatorData: 'synthetic',
      signature: 'synthetic',
    },
  });
  localStorage.setItem(INSTALLATION_KEY, installation);
  await attendanceCalls.clock(scan);
  const request = fetcher.mock.calls[1]?.[0] as Request;
  expect(request.url).toContain('/v1/staff/attendance/clock');
  expect(request.credentials).toBe('include');
  expect(request.cache).toBe('no-store');
  expect(request.headers.has('Authorization')).toBe(false);
  expect(request.headers.get('Idempotency-Key')).toBe('synthetic');
  expect(await request.clone().json()).toMatchObject({
    token: scan.token,
    installation_id: installation,
    challenge_id: 'synthetic',
  });
  const challenge = fetcher.mock.calls[0]?.[0] as Request;
  expect(await challenge.clone().json()).not.toHaveProperty('installation_id');
});
it.each(['offline', 'logout'] as const)(
  '%s after the passkey prompt refuses submission and never queues the command',
  async (reason) => {
    const request = new AbortController();
    fetcher.mockResolvedValueOnce(
      json({ challenge_id: 'synthetic', options: { challenge: 'synthetic' } }),
    );
    vi.mocked(assertStaffAttendance).mockImplementation(async () => {
      if (reason === 'offline') vi.stubGlobal('navigator', { onLine: false });
      else request.abort();
      return {
        id: 'synthetic',
        rawId: 'synthetic',
        type: 'public-key',
        clientExtensionResults: {},
        response: {
          clientDataJSON: 'synthetic',
          authenticatorData: 'synthetic',
          signature: 'synthetic',
        },
      };
    });
    await expect(attendanceCalls.clock(scan, request.signal)).rejects.toThrow(
      'ATTENDANCE_CANCELLED',
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);
it('denied location permission records an absent optional location', async () => {
  const getCurrentPosition = vi.fn((_success: unknown, failure: () => void) => failure());
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
  expect(await attendancePosition()).toBeUndefined();
  expect(getCurrentPosition).toHaveBeenCalledTimes(1);
});
