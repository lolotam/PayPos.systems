import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApiClient } from './client';
import { setDeviceTokenReader } from './device-auth';

const { staffRequestMock } = vi.hoisted(() => ({ staffRequestMock: vi.fn() }));

vi.mock('@capacitor/core', () => ({ CapacitorHttp: { request: staffRequestMock } }));

describe('createApiClient', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setDeviceTokenReader(() => Promise.resolve(null));
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(JSON.stringify({ device_id: 'd1', company_id: 'c1', branch_id: 'b1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
  });

  afterEach(() => {
    setDeviceTokenReader(() => Promise.resolve(null));
    fetchSpy.mockRestore();
  });

  it('attaches Authorization: Device <token> when a device token is stored', async () => {
    setDeviceTokenReader(async () => 'test-device-token');
    const client = createApiClient();

    await client.GET('/v1/devices/me');

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [input, init] = fetchSpy.mock.calls[0] as [RequestInfo | URL, RequestInit | undefined];
    const req = input instanceof Request ? input : new Request(input, init);

    expect(req.headers.get('Authorization')).toBe('Device test-device-token');
  });

  it('carries no Authorization header when no device token is stored', async () => {
    setDeviceTokenReader(async () => null);
    const client = createApiClient();

    await client.GET('/v1/devices/me');

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [input, init] = fetchSpy.mock.calls[0] as [RequestInfo | URL, RequestInit | undefined];
    const req = input instanceof Request ? input : new Request(input, init);

    expect(req.headers.get('Authorization')).toBeNull();
  });

  it('targets the VITE_API_URL base URL', async () => {
    const client = createApiClient();

    await client.GET('/v1/devices/me');

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [input, init] = fetchSpy.mock.calls[0] as [RequestInfo | URL, RequestInit | undefined];
    const req = input instanceof Request ? input : new Request(input, init);

    expect(req.url).toBe('http://127.0.0.1:3000/v1/devices/me');
  });

  it('aborts without sending a network request if reading stored token fails', async () => {
    setDeviceTokenReader(async () => {
      throw new Error('storage read failed');
    });
    const client = createApiClient();

    await expect(client.GET('/v1/devices/me')).rejects.toThrow('storage read failed');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('createApiClient with a custom fetch', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setDeviceTokenReader(() => Promise.resolve(null));
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(JSON.stringify({ device_id: 'd1', company_id: 'c1', branch_id: 'b1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
  });

  afterEach(() => {
    setDeviceTokenReader(() => Promise.resolve(null));
    fetchSpy.mockRestore();
  });

  it('uses a custom fetch with device Authorization and returns its parsed result', async () => {
    setDeviceTokenReader(async () => 'test-device-token');
    const customFetch = vi.fn(async (request: Request) => {
      expect(request.headers.get('Authorization')).toBe('Device test-device-token');
      return new Response(JSON.stringify({ device_id: 'd1', company_id: 'c1', branch_id: 'b1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const client = createApiClient('omit', customFetch);

    const result = await client.GET('/v1/devices/me');

    expect(result.data).toEqual({ device_id: 'd1', company_id: 'c1', branch_id: 'b1' });
    expect(customFetch).toHaveBeenCalledOnce();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('staffApiClient transport selection', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    staffRequestMock.mockReset();
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ source: 'fetch' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    staffRequestMock.mockReset();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('uses the native plugin on iOS and returns its data', async () => {
    vi.stubEnv('VITE_NATIVE', '1');
    vi.stubGlobal('Capacitor', { getPlatform: () => 'ios' });
    staffRequestMock.mockResolvedValue({
      status: 200,
      data: { source: 'native' },
      headers: { 'Content-Type': 'application/json' },
      url: 'http://127.0.0.1:3000/v1/devices/me/staff-session',
    });
    const { staffApiClient } = await import('./client');

    const result = await staffApiClient().GET('/v1/devices/me/staff-session');

    expect(result.data).toEqual({ source: 'native' });
    expect(staffRequestMock).toHaveBeenCalledOnce();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    { native: '1', platform: 'android' },
    { native: '', platform: 'ios' },
  ])('uses fetch with VITE_NATIVE=$native on $platform', async ({ native, platform }) => {
    vi.stubEnv('VITE_NATIVE', native);
    vi.stubGlobal('Capacitor', { getPlatform: () => platform });
    const { staffApiClient } = await import('./client');

    const result = await staffApiClient().GET('/v1/devices/me/staff-session');

    expect(result.data).toEqual({ source: 'fetch' });
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(staffRequestMock).not.toHaveBeenCalled();
  });
});
