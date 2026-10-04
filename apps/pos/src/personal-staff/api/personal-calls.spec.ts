import { beforeEach, expect, it, vi } from 'vitest';
import { personalCalls } from './personal-calls';
import { registerStaffPasskey } from '@pospay/auth/client';
vi.mock('@pospay/auth/client', () => ({ registerStaffPasskey: vi.fn() }));
const fetcher = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', fetcher);
});

it('personal calls include cookies without device credentials', async () => {
  fetcher.mockResolvedValue(
    new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
  );
  await personalCalls.session();
  const request = fetcher.mock.calls[0]?.[0] as Request;
  expect(request.url).toContain('/v1/staff/personal-session');
  expect(request.credentials).toBe('include');
  expect(request.cache).toBe('no-store');
  expect(request.headers.has('Authorization')).toBe(false);
});
it('only a confirmed 401 invalidates a session; unavailable validation throws', async () => {
  fetcher.mockResolvedValueOnce(
    new Response('{}', { status: 401, headers: { 'content-type': 'application/json' } }),
  );
  await expect(personalCalls.session()).resolves.toBeNull();
  fetcher.mockResolvedValueOnce(
    new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } }),
  );
  await expect(personalCalls.session()).rejects.toThrow('PERSONAL_SESSION_UNAVAILABLE');
});
it('cancelled registration sends no verification and never calls generic auth', async () => {
  fetcher.mockResolvedValue(
    new Response(
      JSON.stringify({ challenge_id: 'synthetic', options: { challenge: 'synthetic' } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  );
  vi.mocked(registerStaffPasskey).mockRejectedValue(new Error('SYNTHETIC_CANCEL'));
  await expect(personalCalls.enrol()).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect((fetcher.mock.calls[0]?.[0] as Request).url).toContain('/v1/staff/passkey/options');
});
