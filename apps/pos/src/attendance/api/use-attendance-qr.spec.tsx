import type { AttendanceQrIssue } from '@pospay/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { receivedQr, type ReceivedQr } from '../model/qr-timing';
import { QrRequestError } from './read-attendance-qr';
import { useAttendanceQr } from './use-attendance-qr';

const read = vi.hoisted(() => vi.fn());
vi.mock('./read-attendance-qr', async (original) => ({
  ...(await original<{ QrRequestError: typeof QrRequestError }>()),
  readAttendanceQr: read,
}));

const branch = '01920000-0000-7000-8000-000000000001';
const base = Date.parse('2026-10-02T12:00:00.000Z');
const reject = vi.fn(async () => undefined);
let client: QueryClient;
let online = true;

function fresh(windowOffset = 0): ReceivedQr {
  const server = base + windowOffset * 60_000;
  const issue: AttendanceQrIssue = {
    token: { branch_id: branch, window: Math.floor(server / 60_000), sig: 'ab'.repeat(32) },
    branch: {
      id: branch,
      name_ar: null,
      name_en: 'Test branch',
      effective_timezone: 'Asia/Kuwait',
    },
    server_time: new Date(server).toISOString(),
    refresh_at: new Date(server + 60_000).toISOString(),
    expires_at: new Date(server + 120_000).toISOString(),
  };
  return receivedQr(issue, performance.now(), performance.now(), Date.now());
}

function Wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
  });
  vi.setSystemTime(base);
  online = true;
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  read.mockReset();
  reject.mockClear();
});

afterEach(() => {
  client.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('fetches on each server window and hides the previous QR while the new request is pending', async () => {
  read.mockResolvedValueOnce(fresh());
  let finish!: (value: ReceivedQr) => void;
  read.mockImplementationOnce(
    () =>
      new Promise<ReceivedQr>((resolve) => {
        finish = resolve;
      }),
  );
  const { result, unmount } = renderHook(() => useAttendanceQr(branch, reject), {
    wrapper: Wrapper,
  });
  await flush();
  expect(result.current.payload).not.toBeNull();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(read).toHaveBeenCalledTimes(2);
  expect(result.current.payload).toBeNull();
  await act(async () => {
    finish(fresh(1));
  });
  await flush();
  expect(JSON.parse(result.current.payload ?? '{}').window).toBe(Math.floor(base / 60_000) + 1);
  unmount();
});

it('hides immediately offline and waits for a new successful response after reconnecting', async () => {
  read.mockResolvedValueOnce(fresh());
  let finish!: (value: ReceivedQr) => void;
  read.mockImplementation(
    () =>
      new Promise<ReceivedQr>((resolve) => {
        finish = resolve;
      }),
  );
  const { result, unmount } = renderHook(() => useAttendanceQr(branch, reject), {
    wrapper: Wrapper,
  });
  await flush();
  expect(result.current.payload).not.toBeNull();
  online = false;
  act(() => {
    window.dispatchEvent(new Event('offline'));
  });
  expect(result.current.payload).toBeNull();
  expect(result.current.notice).toBe('offline');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  online = true;
  act(() => {
    window.dispatchEvent(new Event('online'));
  });
  expect(result.current.payload).toBeNull();
  await flush();
  expect(read).toHaveBeenCalledTimes(2);
  await act(async () => {
    finish(fresh());
  });
  await flush();
  expect(result.current.payload).not.toBeNull();
  unmount();
});

it('failed refresh hides a still valid token and a revoked device asks the pairing shell to re-check', async () => {
  read.mockResolvedValueOnce(fresh()).mockRejectedValueOnce(new QrRequestError(false));
  const { result, unmount } = renderHook(() => useAttendanceQr(branch, reject), {
    wrapper: Wrapper,
  });
  await flush();
  act(() => {
    result.current.retry();
  });
  await flush();
  expect(result.current.payload).toBeNull();
  expect(result.current.notice).toBe('unavailable');
  read.mockRejectedValueOnce(new QrRequestError(true));
  act(() => {
    result.current.retry();
  });
  await flush();
  expect(reject).toHaveBeenCalledOnce();
  unmount();
});

it('refreshes on resume and discards a late response already beyond its display window', async () => {
  const delayed = receivedQr(fresh().issue, 0, 65_000, base);
  read.mockResolvedValueOnce(delayed).mockResolvedValueOnce(fresh(1));
  const { result, unmount } = renderHook(() => useAttendanceQr(branch, reject), {
    wrapper: Wrapper,
  });
  await flush();
  expect(result.current.payload).toBeNull();
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await flush();
  expect(read).toHaveBeenCalledTimes(2);
  expect(result.current.payload).not.toBeNull();
  unmount();
});
