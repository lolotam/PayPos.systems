import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { personalCalls } from '@/personal-staff/api/personal-calls';
import { announcePersonalChange } from '@/personal-staff/model/session-change';
import { disablePushOnSignOut } from '@/personal-staff/push/push-disable';
import { nativeStaffFetch } from '@/shared/api/native-staff-fetch';

import { endPersonalSession } from './end-sessions';

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));

vi.mock('@capacitor/core', () => ({ CapacitorHttp: { request: requestMock } }));

vi.mock('@/personal-staff/api/personal-calls', () => ({
  personalCalls: { signOut: vi.fn() },
}));
vi.mock('@/personal-staff/model/session-change', () => ({
  announcePersonalChange: vi.fn(),
}));
vi.mock('@/personal-staff/push/push-disable', () => ({
  disablePushOnSignOut: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(disablePushOnSignOut).mockResolvedValue(undefined);
});

describe('endPersonalSession', () => {
  it('counts the answer of the server as done and tells every screen to drop its cache', async () => {
    vi.mocked(personalCalls.signOut).mockResolvedValue(undefined);

    await expect(endPersonalSession()).resolves.toBe('done');
    expect(disablePushOnSignOut).toHaveBeenCalledTimes(1);
    expect(personalCalls.signOut).toHaveBeenCalledTimes(1);
    expect(vi.mocked(disablePushOnSignOut).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(personalCalls.signOut).mock.invocationCallOrder[0] ?? 0,
    );
    expect(announcePersonalChange).toHaveBeenCalledTimes(1);
  });

  it('passes the abort signal to the sign-out, and nothing when there is none', async () => {
    vi.mocked(personalCalls.signOut).mockResolvedValue(undefined);
    const controller = new AbortController();

    await expect(endPersonalSession(controller.signal)).resolves.toBe('done');
    expect(personalCalls.signOut).toHaveBeenNthCalledWith(1, controller.signal);

    await expect(endPersonalSession()).resolves.toBe('done');
    expect(personalCalls.signOut).toHaveBeenNthCalledWith(2, undefined);
  });

  it('an aborted sign-out fails without announcing the change', async () => {
    const controller = new AbortController();
    controller.abort();
    vi.mocked(personalCalls.signOut).mockImplementation(async (signal?: AbortSignal) => {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    });

    await expect(endPersonalSession(controller.signal)).resolves.toBe('failed');
    expect(announcePersonalChange).not.toHaveBeenCalled();
  });

  it('gives up on a stalled push cleanup when the sign-out is aborted', async () => {
    const controller = new AbortController();
    vi.mocked(disablePushOnSignOut).mockReturnValue(new Promise<void>(() => undefined));

    const ending = endPersonalSession(controller.signal);
    controller.abort();

    await expect(ending).resolves.toBe('failed');
    expect(personalCalls.signOut).not.toHaveBeenCalled();
    expect(announcePersonalChange).not.toHaveBeenCalled();
  });

  it.each(['PERSONAL_SIGN_OUT_REFUSED', 'PERSONAL_SIGN_OUT_UNCLEAR', 'TypeError'])(
    'fails without announcing when the sign-out ends with %s',
    async (code) => {
      vi.mocked(personalCalls.signOut).mockRejectedValue(
        code === 'TypeError' ? new TypeError('Failed to fetch') : new Error(code),
      );

      await expect(endPersonalSession()).resolves.toBe('failed');
      expect(announcePersonalChange).not.toHaveBeenCalled();
    },
  );
});

describe('endPersonalSession late native sign-out completion', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', 'http://127.0.0.1:3000');
    requestMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('announces personal change when an aborted native sign-out settles late with signed_out', async () => {
    let settle!: (value: {
      status: number;
      data: unknown;
      headers: Record<string, string>;
    }) => void;
    requestMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    const controller = new AbortController();
    const pending = nativeStaffFetch(
      new Request('http://127.0.0.1:3000/v1/staff/personal-session/sign-out', {
        method: 'POST',
        signal: controller.signal,
      }),
    );
    await vi.waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));

    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(announcePersonalChange).not.toHaveBeenCalled();

    settle({
      status: 200,
      data: { status: 'SIGNED_OUT' },
      headers: { 'Content-Type': 'application/json' },
    });
    await vi.waitFor(() => expect(announcePersonalChange).toHaveBeenCalledTimes(1));
  });
});

describe('endPersonalSession late non-2xx native response', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', 'http://127.0.0.1:3000');
    requestMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('ignores late aborted responses from other paths or non-2xx statuses', async () => {
    let settleOther!: (value: {
      status: number;
      data: unknown;
      headers: Record<string, string>;
    }) => void;
    requestMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settleOther = resolve;
        }),
    );
    const controller = new AbortController();
    const pending = nativeStaffFetch(
      new Request('http://127.0.0.1:3000/v1/staff/personal-session/sign-out', {
        method: 'POST',
        signal: controller.signal,
      }),
    );
    await vi.waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));

    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });

    settleOther({
      status: 500,
      data: { status: 'SIGNED_OUT' },
      headers: { 'Content-Type': 'application/json' },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(announcePersonalChange).not.toHaveBeenCalled();
  });
});

describe('endPersonalSession late double-encoded sign-out rejection', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', 'http://127.0.0.1:3000');
    requestMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('ignores double-encoded JSON sign-out strings just like normal sign-out', async () => {
    let settleString!: (value: {
      status: number;
      data: unknown;
      headers: Record<string, string>;
    }) => void;
    requestMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settleString = resolve;
        }),
    );
    const controller = new AbortController();
    const pending = nativeStaffFetch(
      new Request('http://127.0.0.1:3000/v1/staff/personal-session/sign-out', {
        method: 'POST',
        signal: controller.signal,
      }),
    );
    await vi.waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));

    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });

    settleString({
      status: 200,
      data: JSON.stringify({ status: 'SIGNED_OUT' }),
      headers: { 'Content-Type': 'application/json' },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(announcePersonalChange).not.toHaveBeenCalled();
  });
});

describe('endPersonalSession late text/plain JSON sign-out parity', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', 'http://127.0.0.1:3000');
    requestMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('announces personal change when a late JSON sign-out arrives as text/plain', async () => {
    let settleText!: (value: {
      status: number;
      data: unknown;
      headers: Record<string, string>;
    }) => void;
    requestMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settleText = resolve;
        }),
    );
    const controller = new AbortController();
    const pending = nativeStaffFetch(
      new Request('http://127.0.0.1:3000/v1/staff/personal-session/sign-out', {
        method: 'POST',
        signal: controller.signal,
      }),
    );
    await vi.waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));

    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });

    settleText({
      status: 200,
      data: JSON.stringify({ status: 'SIGNED_OUT' }),
      headers: { 'Content-Type': 'text/plain' },
    });
    await vi.waitFor(() => expect(announcePersonalChange).toHaveBeenCalledTimes(1));
  });
});
