import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { nativeStaffFetch } from './native-staff-fetch';

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));

vi.mock('@capacitor/core', () => ({ CapacitorHttp: { request: requestMock } }));

function nativeResponse() {
  return {
    status: 200,
    data: { ok: true },
    headers: { 'Content-Type': 'application/json' },
    url: 'http://127.0.0.1:3000/v1/devices/me/staff-session',
  };
}

describe('nativeStaffFetch synchronous fence handoff', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', 'http://127.0.0.1:3000');
    requestMock.mockReset();
    requestMock.mockResolvedValue(nativeResponse());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('fences a follow-up request started immediately after aborting an in-flight call', async () => {
    let settleFirst!: () => void;
    requestMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            settleFirst = () => resolve(nativeResponse());
          }),
      )
      .mockResolvedValueOnce(nativeResponse());

    const controller = new AbortController();
    const first = nativeStaffFetch(
      new Request('http://127.0.0.1:3000/v1/devices/me/staff-session', {
        method: 'DELETE',
        signal: controller.signal,
      }),
    );
    await vi.waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));

    controller.abort();
    const followUp = nativeStaffFetch(
      new Request('http://127.0.0.1:3000/v1/devices/me/staff-session'),
    );

    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve();
    expect(requestMock).toHaveBeenCalledTimes(1);

    settleFirst();
    const response = await followUp;
    expect(response.status).toBe(200);
    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it('avoids unhandled rejections when aborted before loading the native plugin completes', async () => {
    const controller = new AbortController();
    const pending = nativeStaffFetch(
      new Request('http://127.0.0.1:3000/v1/devices/me/staff-session', {
        signal: controller.signal,
      }),
    );
    queueMicrotask(() => controller.abort());

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
