import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { usesNativeStaffTransport } from '@/shared/platform/native-shell';

import { checkServerReachable, FIRST_SAVE_REACHABILITY_WAIT_MS } from './server-reachability';

const nativeRequestMock = vi.hoisted(() => vi.fn());

vi.mock('@capacitor/core', () => ({
  CapacitorHttp: { request: nativeRequestMock },
}));
vi.mock('@/shared/platform/native-shell', () => ({
  usesNativeStaffTransport: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VITE_API_URL', 'https://api.staging.pospay.systems');
  vi.mocked(usesNativeStaffTransport).mockReturnValue(false);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it('returns true only when /health responds 200 with status ok (#566)', async () => {
  const fetchMock = vi.fn<(request: Request) => Promise<Response>>(async () =>
    Response.json({ status: 'ok' }, { status: 200 }),
  );
  vi.stubGlobal('fetch', fetchMock);

  await expect(checkServerReachable()).resolves.toBe(true);
  const req = fetchMock.mock.calls[0]?.[0];
  expect(req).toBeInstanceOf(Request);
  if (!req) return;
  expect(new URL(req.url).toString()).toBe('https://api.staging.pospay.systems/health');
  expect(req.method).toBe('GET');
  expect(req.cache).toBe('no-store');
  expect(req.credentials).toBe('omit');
  expect(req.redirect).toBe('error');
});

it('rejects captive-portal HTML or mismatched JSON payloads (#566)', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(
        new Response('<html>portal</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
      )
      .mockResolvedValueOnce(Response.json({ status: 'portal' }, { status: 200 }))
      .mockResolvedValueOnce(Response.json({ status: 'ok' }, { status: 503 })),
  );

  await expect(checkServerReachable()).resolves.toBe(false);
  await expect(checkServerReachable()).resolves.toBe(false);
  await expect(checkServerReachable()).resolves.toBe(false);
});

it('returns false on network error and aborts after the bounded timeout (#566)', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }),
  );
  await expect(checkServerReachable()).resolves.toBe(false);

  vi.useFakeTimers();
  let seenSignal: AbortSignal | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn((request: Request) => {
      seenSignal = request.signal;
      return new Promise<Response>(() => undefined);
    }),
  );

  const check = checkServerReachable();
  await vi.advanceTimersByTimeAsync(FIRST_SAVE_REACHABILITY_WAIT_MS);
  await expect(check).resolves.toBe(false);
  expect(seenSignal?.aborted).toBe(true);
});

it('uses direct no-cache CapacitorHttp on iOS and allows immediate retry after timeout (#566)', async () => {
  vi.mocked(usesNativeStaffTransport).mockReturnValue(true);
  vi.useFakeTimers();
  nativeRequestMock
    .mockImplementationOnce(() => new Promise(() => undefined))
    .mockResolvedValueOnce({
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      data: { status: 'ok' },
    });

  const firstAttempt = checkServerReachable();
  await vi.advanceTimersByTimeAsync(FIRST_SAVE_REACHABILITY_WAIT_MS);
  await expect(firstAttempt).resolves.toBe(false);

  await expect(checkServerReachable()).resolves.toBe(true);
  expect(nativeRequestMock).toHaveBeenCalledTimes(2);
  expect(nativeRequestMock.mock.calls[1]?.[0]).toEqual({
    url: 'https://api.staging.pospay.systems/health',
    method: 'GET',
    headers: {
      'Cache-Control': 'no-cache, no-store, max-age=0',
      Pragma: 'no-cache',
    },
    disableRedirects: true,
    connectTimeout: FIRST_SAVE_REACHABILITY_WAIT_MS,
    readTimeout: FIRST_SAVE_REACHABILITY_WAIT_MS,
    responseType: 'text',
  });
});

it('rejects double-encoded JSON, captive portal HTML, and 302 redirects on iOS (#566)', async () => {
  vi.mocked(usesNativeStaffTransport).mockReturnValue(true);
  nativeRequestMock
    .mockResolvedValueOnce({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ status: 'ok' }),
    })
    .mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'text/plain' },
      data: JSON.stringify(JSON.stringify({ status: 'ok' })),
    })
    .mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'text/html' },
      data: '<html>portal</html>',
    })
    .mockResolvedValueOnce({ status: 302, headers: {}, data: '' });

  await expect(checkServerReachable()).resolves.toBe(false);
  await expect(checkServerReachable()).resolves.toBe(false);
  await expect(checkServerReachable()).resolves.toBe(false);
  await expect(checkServerReachable()).resolves.toBe(false);
});

it('propagates missing VITE_API_URL config errors instead of showing needsInternet (#566)', async () => {
  vi.stubEnv('VITE_API_URL', '');
  await expect(checkServerReachable()).rejects.toThrow('VITE_API_URL is not set');
});
