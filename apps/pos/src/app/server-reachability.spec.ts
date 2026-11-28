import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { nativeStaffFetch } from '@/shared/api/native-staff-fetch';
import { usesNativeStaffTransport } from '@/shared/platform/native-shell';

import { checkServerReachable, FIRST_SAVE_REACHABILITY_WAIT_MS } from './server-reachability';

vi.mock('@/shared/api/native-staff-fetch', () => ({
  nativeStaffFetch: vi.fn(),
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

it('uses nativeStaffFetch when the iOS native transport is active (#566)', async () => {
  vi.mocked(usesNativeStaffTransport).mockReturnValue(true);
  vi.mocked(nativeStaffFetch).mockResolvedValue(Response.json({ status: 'ok' }, { status: 200 }));

  await expect(checkServerReachable()).resolves.toBe(true);
  expect(nativeStaffFetch).toHaveBeenCalledTimes(1);
});

it('propagates missing VITE_API_URL config errors instead of showing needsInternet (#566)', async () => {
  vi.stubEnv('VITE_API_URL', '');
  await expect(checkServerReachable()).rejects.toThrow('VITE_API_URL is not set');
});
