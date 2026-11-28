import { QueryClient } from '@tanstack/react-query';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { LeaveContext } from '@/my-leave/model/context';
import { LeaveHttpError } from '@/my-leave/model/read-error';
import { recoverLeaveSession } from './recover-leave-session';

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const common = {
  company_id: id(1),
  business_id: id(2),
  user_id: id(3),
  expires_at: '2026-10-04T12:00:00Z',
};
const personal = { ...common, employee_id: id(4) };
const reception = { ...common, branch_id: id(5), device_id: id(6) };

const fetchHandler = vi.fn<(request: Request) => Promise<Response>>();
vi.mock('@/shared/api/device-auth', () => ({ currentDeviceToken: async () => 'synthetic-device' }));

beforeAll(() => {
  vi.stubGlobal('fetch', (request: Request) => fetchHandler(request));
});

beforeEach(() => {
  fetchHandler.mockReset();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-04T10:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

it.each(['personal', 'reception'] as const)(
  'prevents a delayed 401 probe from clearing a %s session confirmed by a later poll (#891)',
  async (mode) => {
    const base = mode === 'personal' ? personal : reception;
    const key = [mode === 'personal' ? 'personal-session' : 'staff-session', 0];
    const cache = new QueryClient();
    cache.setQueryData(key, base);
    cache.setQueryData(['other-private'], 'keep private');

    let releaseDelayedProbe!: (response: Response) => void;
    let callCount = 0;
    fetchHandler.mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        return new Promise<Response>((resolve) => {
          releaseDelayedProbe = resolve;
        });
      }
      return Promise.resolve(Response.json(base));
    });

    const context: LeaveContext = { mode, ...base, sessionEpoch: 0 };
    const recovery = recoverLeaveSession(context, '', new AbortController().signal, cache);
    await vi.waitFor(() => expect(callCount).toBe(1));

    await cache.fetchQuery({ queryKey: key, queryFn: async () => base });
    releaseDelayedProbe(Response.json({}, { status: 401 }));

    await expect(recovery).rejects.toMatchObject({ name: 'AbortError' });
    expect(cache.getQueryData(key)).toEqual(base);
    expect(cache.getQueryData(['other-private'])).toBe('keep private');

    callCount = 0;
    const expiringRecovery = recoverLeaveSession(context, '', new AbortController().signal, cache);
    await vi.waitFor(() => expect(callCount).toBe(1));
    await cache.fetchQuery({ queryKey: key, queryFn: async () => base });
    vi.setSystemTime(new Date('2026-10-04T12:00:00Z'));
    releaseDelayedProbe(Response.json({}, { status: 401 }));

    const rejection = await expiringRecovery.catch((err: unknown) => err);
    expect(rejection).toBeInstanceOf(LeaveHttpError);
    expect(rejection).toMatchObject({ status: 401, message: 'UNAUTHENTICATED' });
    expect(cache.getQueryData(key)).toBeNull();
  },
);

it('aborts before listing leave if a QueryCache listener overwrites the session during publish (#891)', async () => {
  const key = ['personal-session', 0];
  const other = { ...personal, user_id: id(9) };
  const cache = new QueryClient();
  cache.setQueryData(key, personal);

  const requestedUrls: string[] = [];
  fetchHandler.mockImplementation(async (request: Request) => {
    requestedUrls.push(new URL(request.url).pathname);
    return Response.json(personal);
  });

  let injected = false;
  const unsub = cache.getQueryCache().subscribe((event) => {
    if (
      !injected &&
      event.type === 'updated' &&
      event.action.type === 'success' &&
      event.query.state.dataUpdateCount === 2
    ) {
      injected = true;
      cache.setQueryData(key, other);
    }
  });

  const context: LeaveContext = { mode: 'personal', ...personal, sessionEpoch: 0 };
  try {
    await expect(
      recoverLeaveSession(context, id(5), new AbortController().signal, cache),
    ).rejects.toMatchObject({ name: 'AbortError' });
  } finally {
    unsub();
  }

  expect(injected).toBe(true);
  expect(cache.getQueryData(key)).toEqual(other);
  expect(requestedUrls).toEqual(['/v1/staff/personal-session']);
});

it('rejects with 401 LeaveHttpError and clears session when expires_at passes during cancelQueries (#891)', async () => {
  const key = ['personal-session', 0];
  const cache = new QueryClient();
  cache.setQueryData(key, personal);
  fetchHandler.mockResolvedValue(Response.json(personal));

  const origCancel = cache.cancelQueries.bind(cache);
  vi.spyOn(cache, 'cancelQueries').mockImplementationOnce(async (...args) => {
    vi.setSystemTime(new Date('2026-10-04T12:00:00Z'));
    return origCancel(...args);
  });

  const rejection = await recoverLeaveSession(
    { mode: 'personal', ...personal, sessionEpoch: 0 },
    '',
    new AbortController().signal,
    cache,
  ).catch((error: unknown) => error);
  expect(rejection).toBeInstanceOf(LeaveHttpError);
  expect(rejection).toMatchObject({ status: 401, message: 'UNAUTHENTICATED' });
  expect(cache.getQueryData(key)).toBeNull();
});
