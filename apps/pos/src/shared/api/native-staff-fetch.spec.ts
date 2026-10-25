import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { nativeStaffFetch } from './native-staff-fetch';

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));

vi.mock('@capacitor/core', () => ({ CapacitorHttp: { request: requestMock } }));

function nativeResponse(overrides = {}) {
  return {
    status: 200,
    data: { ok: true },
    headers: { 'Content-Type': 'application/json' },
    url: 'http://127.0.0.1:3000/v1/devices/me/staff-session',
    ...overrides,
  };
}

function stubNativeTransport(): void {
  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', 'http://127.0.0.1:3000');
    requestMock.mockReset();
    requestMock.mockResolvedValue(nativeResponse());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });
}

describe('nativeStaffFetch requests', () => {
  stubNativeTransport();

  it('sends an API POST natively with the required origin, credentials and body', async () => {
    const request = new Request('http://127.0.0.1:3000/v1/devices/me/staff-pin/sign-in', {
      method: 'POST',
      headers: { Authorization: 'Device device-fixture', 'Content-Type': 'application/json' },
      body: '{"phone":"fixture","pin":"fixture"}',
    });

    const response = await nativeStaffFetch(request);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"ok":true}');
    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(requestMock).toHaveBeenCalledWith({
      url: request.url,
      method: 'POST',
      headers: {
        authorization: 'Device device-fixture',
        'content-type': 'application/json',
        Origin: 'capacitor://localhost',
      },
      data: '{"phone":"fixture","pin":"fixture"}',
      disableRedirects: true,
      connectTimeout: 15000,
      readTimeout: 15000,
      responseType: 'text',
    });
  });

  it('sends a GET without data', async () => {
    const response = await nativeStaffFetch(
      new Request('http://127.0.0.1:3000/v1/devices/me/staff-session'),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"ok":true}');
    expect(response.headers.get('Content-Type')).toBe('application/json');
    const [options] = requestMock.mock.calls[0] ?? [];
    expect(options).not.toHaveProperty('data');
  });

  it('rejects a foreign URL without calling the plugin', async () => {
    const request = new Request('https://outside.example/v1/devices/me/staff-session');

    await expect(nativeStaffFetch(request)).rejects.toThrow('NATIVE_FETCH_FOREIGN_URL');
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('accepts an equivalent origin with different host case and a default port', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api-host.example');
    const request = new Request('https://API-HOST.example:443/v1/devices/me/staff-session');

    const response = await nativeStaffFetch(request);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"ok":true}');
    expect(requestMock).toHaveBeenCalledOnce();
  });
});

describe('nativeStaffFetch response headers and empty bodies', () => {
  stubNativeTransport();

  it('removes Set-Cookie response headers in any letter case', async () => {
    requestMock.mockResolvedValue(
      nativeResponse({
        headers: {
          'Set-Cookie': 'first=fixture',
          'set-cookie': 'second=fixture',
          'X-Result': 'ok',
        },
      }),
    );

    const response = await nativeStaffFetch(
      new Request('http://127.0.0.1:3000/v1/devices/me/staff-session'),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"ok":true}');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('X-Result')).toBe('ok');
  });

  it('resolves a 204 with an empty body', async () => {
    requestMock.mockResolvedValue(nativeResponse({ status: 204, data: '', headers: {} }));

    const response = await nativeStaffFetch(
      new Request('http://127.0.0.1:3000/v1/devices/me/staff-session', { method: 'DELETE' }),
    );

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect([...response.headers]).toEqual([]);
  });
});

describe('nativeStaffFetch response bodies and HTTP errors', () => {
  stubNativeTransport();

  it('serializes object data and preserves string data', async () => {
    requestMock
      .mockResolvedValueOnce(nativeResponse({ data: { authenticated: true } }))
      .mockResolvedValueOnce(
        nativeResponse({
          data: 'plain-response',
          headers: { 'Content-Type': 'text/plain' },
        }),
      );
    const request = () => new Request('http://127.0.0.1:3000/v1/devices/me/staff-session');

    const objectResponse = await nativeStaffFetch(request());
    const stringResponse = await nativeStaffFetch(request());

    expect(objectResponse.status).toBe(200);
    expect(await objectResponse.text()).toBe('{"authenticated":true}');
    expect(objectResponse.headers.get('Content-Type')).toBe('application/json');
    expect(stringResponse.status).toBe(200);
    expect(await stringResponse.text()).toBe('plain-response');
    expect(stringResponse.headers.get('Content-Type')).toBe('text/plain');
  });

  it('quotes a JSON string fragment in the response body', async () => {
    requestMock.mockResolvedValue(nativeResponse({ data: 'parsed-fragment' }));

    const response = await nativeStaffFetch(
      new Request('http://127.0.0.1:3000/v1/devices/me/staff-session'),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('"parsed-fragment"');
    expect(response.headers.get('Content-Type')).toBe('application/json');
  });

  it('resolves an HTTP 401 with its body instead of rejecting', async () => {
    requestMock.mockResolvedValue(nativeResponse({ status: 401, data: { code: 'UNAUTHORIZED' } }));

    const response = await nativeStaffFetch(
      new Request('http://127.0.0.1:3000/v1/devices/me/staff-session'),
    );

    expect(response.status).toBe(401);
    expect(await response.text()).toBe('{"code":"UNAUTHORIZED"}');
    expect(response.headers.get('Content-Type')).toBe('application/json');
  });
});

describe('nativeStaffFetch aborts', () => {
  stubNativeTransport();

  it('rejects an already aborted request without calling the plugin', async () => {
    const controller = new AbortController();
    controller.abort();
    const request = new Request('http://127.0.0.1:3000/v1/devices/me/staff-session', {
      signal: controller.signal,
    });

    await expect(nativeStaffFetch(request)).rejects.toMatchObject({ name: 'AbortError' });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('drops the native result when the request is aborted during the call', async () => {
    let resolveNative!: (value: ReturnType<typeof nativeResponse>) => void;
    requestMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveNative = resolve;
        }),
    );
    const controller = new AbortController();
    const request = new Request('http://127.0.0.1:3000/v1/devices/me/staff-session', {
      signal: controller.signal,
    });

    const pending = nativeStaffFetch(request);
    await vi.waitFor(() => expect(requestMock).toHaveBeenCalledOnce());
    controller.abort();
    resolveNative(nativeResponse());

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('nativeStaffFetch transport failures', () => {
  stubNativeTransport();

  it('rejects with the plugin transport error', async () => {
    const failure = new Error('native transport failed');
    requestMock.mockRejectedValue(failure);

    await expect(
      nativeStaffFetch(new Request('http://127.0.0.1:3000/v1/devices/me/staff-session')),
    ).rejects.toBe(failure);
  });
});
