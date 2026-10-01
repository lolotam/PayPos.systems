import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApiClient } from './client';
import { setDeviceTokenReader } from './device-auth';

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
