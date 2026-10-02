import type { AttendanceQrIssue } from '@pospay/contracts';
import { describe, expect, it, vi } from 'vitest';

import { QrRequestError, readAttendanceQr } from './read-attendance-qr';

const post = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ POST: post }) }));
const branch = '01920000-0000-7000-8000-000000000001';
const body: AttendanceQrIssue = {
  token: { branch_id: branch, window: 1, sig: 'ab'.repeat(32) },
  branch: { id: branch, name_ar: null, name_en: 'Test branch', effective_timezone: 'Asia/Kuwait' },
  server_time: '1970-01-01T00:01:00.000Z',
  refresh_at: '1970-01-01T00:02:00.000Z',
  expires_at: '1970-01-01T00:03:00.000Z',
};

describe('generated attendance issuer client', () => {
  it('posts without a caller-selected branch, bypasses caches and passes cancellation', async () => {
    post.mockResolvedValueOnce({ data: body, response: new Response(null, { status: 200 }) });
    const signal = new AbortController().signal;
    const received = await readAttendanceQr(signal);
    expect(received.issue).toEqual(body);
    expect(post).toHaveBeenLastCalledWith('/v1/devices/me/attendance-qr', {
      signal: expect.any(AbortSignal),
      cache: 'no-store',
    });
  });

  it('refuses malformed and inconsistent window timing from a response', async () => {
    for (const data of [
      { ...body, secret: 'synthetic-extra-field' },
      { ...body, token: { ...body.token, window: 2 } },
    ]) {
      post.mockResolvedValueOnce({ data, response: new Response(null, { status: 200 }) });
      await expect(readAttendanceQr(new AbortController().signal)).rejects.toThrow();
    }
  });

  it('classifies revocation separately from network loss', async () => {
    post.mockResolvedValueOnce({ response: new Response(null, { status: 401 }) });
    await expect(readAttendanceQr(new AbortController().signal)).rejects.toMatchObject({
      rejected: true,
    });
    post.mockRejectedValueOnce(new Error('synthetic network failure'));
    await expect(readAttendanceQr(new AbortController().signal)).rejects.toBeInstanceOf(
      QrRequestError,
    );
  });
});
