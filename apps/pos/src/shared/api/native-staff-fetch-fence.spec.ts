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
});

describe('nativeStaffFetch suspended fence abort safety', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', 'http://127.0.0.1:3000');
    requestMock.mockReset();
    requestMock.mockResolvedValue(nativeResponse());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('aborts cleanly with no unhandled rejection while suspended on the abort fence', async () => {
    let settleFirst!: () => void;
    requestMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            settleFirst = () => resolve(nativeResponse());
          }),
      )
      .mockResolvedValueOnce(nativeResponse());

    const controllerA = new AbortController();
    const first = nativeStaffFetch(
      new Request('http://127.0.0.1:3000/v1/devices/me/staff-session', {
        method: 'DELETE',
        signal: controllerA.signal,
      }),
    );
    await vi.waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    controllerA.abort();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });

    const controllerB = new AbortController();
    const blocked = nativeStaffFetch(
      new Request('http://127.0.0.1:3000/v1/staff/personal-session', {
        method: 'GET',
        signal: controllerB.signal,
      }),
    );
    await Promise.resolve();
    controllerB.abort();

    await expect(blocked).rejects.toMatchObject({ name: 'AbortError' });
    settleFirst();
    await Promise.resolve();
    await Promise.resolve();
  });
});

describe('nativeStaffFetch mutation serialization', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', 'http://127.0.0.1:3000');
    requestMock.mockReset();
    requestMock.mockResolvedValue(nativeResponse());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('queues concurrent POST mutations while still allowing concurrent GET reads', async () => {
    let settleFirstPost!: () => void;
    requestMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            settleFirstPost = () => resolve(nativeResponse());
          }),
      )
      .mockResolvedValueOnce(nativeResponse())
      .mockResolvedValueOnce(nativeResponse());

    const firstPost = nativeStaffFetch(
      new Request('http://127.0.0.1:3000/v1/staff/personal-otp/verify', { method: 'POST' }),
    );
    await vi.waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));

    const secondPost = nativeStaffFetch(
      new Request('http://127.0.0.1:3000/v1/staff/personal-session/sign-out', { method: 'POST' }),
    );
    const concurrentGet = nativeStaffFetch(
      new Request('http://127.0.0.1:3000/v1/staff/personal-session', { method: 'GET' }),
    );

    const getRes = await concurrentGet;
    expect(getRes.status).toBe(200);
    expect(requestMock).toHaveBeenCalledTimes(2);
    expect(requestMock.mock.calls[1]?.[0]).toMatchObject({ method: 'GET' });

    settleFirstPost();
    expect((await firstPost).status).toBe(200);
    expect((await secondPost).status).toBe(200);
    expect(requestMock).toHaveBeenCalledTimes(3);
    expect(requestMock.mock.calls[2]?.[0]).toMatchObject({
      method: 'POST',
      url: 'http://127.0.0.1:3000/v1/staff/personal-session/sign-out',
    });
  });
});

describe('nativeStaffFetch atomic simultaneous mutation turn reservation', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', 'http://127.0.0.1:3000');
    requestMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('serializes two simultaneous POST mutations even when the first has an async body read', async () => {
    let settleFirst!: () => void;
    requestMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            settleFirst = () => resolve(nativeResponse());
          }),
      )
      .mockResolvedValueOnce(nativeResponse());

    const first = nativeStaffFetch(
      new Request('http://127.0.0.1:3000/v1/staff/personal-otp/verify', {
        method: 'POST',
        body: JSON.stringify({ phone: '50000001' }),
      }),
    );
    const second = nativeStaffFetch(
      new Request('http://127.0.0.1:3000/v1/staff/personal-session/sign-out', {
        method: 'POST',
      }),
    );

    await vi.waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(requestMock.mock.calls[0]?.[0]).toMatchObject({
      url: 'http://127.0.0.1:3000/v1/staff/personal-otp/verify',
    });

    settleFirst();
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
    expect(requestMock).toHaveBeenCalledTimes(2);
    expect(requestMock.mock.calls[1]?.[0]).toMatchObject({
      url: 'http://127.0.0.1:3000/v1/staff/personal-session/sign-out',
    });
  });
});

describe('nativeStaffFetch multi-waiter queue after abort fence release', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', 'http://127.0.0.1:3000');
    requestMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('keeps a second waiting POST queued when two POSTs share an abort fence release', async () => {
    let settleAborted!: () => void;
    let settleSecond!: () => void;
    requestMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            settleAborted = () => resolve(nativeResponse());
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            settleSecond = () => resolve(nativeResponse());
          }),
      )
      .mockResolvedValueOnce(nativeResponse());

    const controller = new AbortController();
    const aborted = nativeStaffFetch(
      new Request('http://127.0.0.1:3000/v1/devices/me/staff-session', {
        method: 'DELETE',
        signal: controller.signal,
      }),
    );
    await vi.waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });

    const queuedOne = nativeStaffFetch(
      new Request('http://127.0.0.1:3000/v1/staff/personal-otp/verify', { method: 'POST' }),
    );
    const queuedTwo = nativeStaffFetch(
      new Request('http://127.0.0.1:3000/v1/staff/personal-session/sign-out', { method: 'POST' }),
    );
    await Promise.resolve();
    expect(requestMock).toHaveBeenCalledTimes(1);

    settleAborted();
    await vi.waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
    await Promise.resolve();
    expect(requestMock).toHaveBeenCalledTimes(2);

    settleSecond();
    expect((await queuedOne).status).toBe(200);
    expect((await queuedTwo).status).toBe(200);
    expect(requestMock).toHaveBeenCalledTimes(3);
  });
});

describe('nativeStaffFetch stalled body abort release', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', 'http://127.0.0.1:3000');
    requestMock.mockReset();
    requestMock.mockResolvedValue(nativeResponse());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('releases the mutation queue immediately when aborted during a stalled request body read', async () => {
    const controller = new AbortController();
    const stalledReq = new Request('http://127.0.0.1:3000/v1/staff/personal-otp/verify', {
      method: 'POST',
      body: JSON.stringify({ phone: '50000001' }),
      signal: controller.signal,
    });
    vi.spyOn(stalledReq, 'text').mockImplementationOnce(() => new Promise<string>(() => undefined));

    const first = nativeStaffFetch(stalledReq);
    const second = nativeStaffFetch(
      new Request('http://127.0.0.1:3000/v1/staff/personal-session/sign-out', { method: 'POST' }),
    );
    await Promise.resolve();
    expect(requestMock).toHaveBeenCalledTimes(0);

    controller.abort();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    expect((await second).status).toBe(200);
    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(requestMock.mock.calls[0]?.[0]).toMatchObject({
      url: 'http://127.0.0.1:3000/v1/staff/personal-session/sign-out',
    });
  });
});
