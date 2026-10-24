import { beforeEach, expect, it, vi } from 'vitest';
import { signOutStaff } from './staff-calls';

const fetcher = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', fetcher);
});

it('a sign-out resolves on both statuses and refuses a rejection', async () => {
  const answered = (status: string) =>
    new Response(JSON.stringify({ status }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  fetcher.mockResolvedValueOnce(answered('SIGNED_OUT'));
  await expect(signOutStaff()).resolves.toBeUndefined();
  fetcher.mockResolvedValueOnce(answered('NO_SESSION'));
  await expect(signOutStaff()).resolves.toBeUndefined();
  fetcher.mockResolvedValueOnce(
    new Response(JSON.stringify({ code: 'FORBIDDEN' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    }),
  );
  await expect(signOutStaff()).rejects.toThrow('STAFF_SIGN_OUT_REFUSED');
});

it.each([{}, { status: 'MAYBE' }])('an unclear answer stops the caller', async (body) => {
  fetcher.mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
  await expect(signOutStaff()).rejects.toThrow('STAFF_SIGN_OUT_UNCLEAR');
});

it('the sign-out goes to the staff session route with the browser credentials', async () => {
  fetcher.mockResolvedValue(
    new Response(JSON.stringify({ status: 'NO_SESSION' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
  await signOutStaff();
  const request = fetcher.mock.calls[0]?.[0] as Request;
  expect(request.url).toContain('/v1/devices/me/staff-session/sign-out');
  expect(request.credentials).toBe('include');
});
