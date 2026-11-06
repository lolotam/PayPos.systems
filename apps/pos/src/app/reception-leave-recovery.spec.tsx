import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useStaffLogin } from '@/staff-login/api/use-staff-login';
import { LocaleProvider } from '@/shared/locale/locale-context';
import { OwnLeaveEntry } from './own-leave-entry';

const session = {
  company_id: '10000000-0000-4000-8000-000000000001',
  business_id: '10000000-0000-4000-8000-000000000002',
  user_id: '10000000-0000-4000-8000-000000000003',
  branch_id: '10000000-0000-4000-8000-000000000005',
  device_id: '10000000-0000-4000-8000-000000000004',
  expires_at: '2026-10-04T12:00:00Z',
};
const branch = '10000000-0000-4000-8000-000000000005';
vi.mock('@/shared/api/device-auth', () => ({ currentDeviceToken: async () => 'synthetic-device' }));
let fresh: typeof session;
let probes: number;
let refused: boolean;
let probeFailure: boolean;
let holdOuter = false;
let finishOuter: ((response: Response) => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-04T10:00:00Z'));
  holdOuter = false;
  finishOuter = undefined;
  fresh = { ...session };
  probes = 0;
  refused = false;
  probeFailure = false;
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  vi.stubGlobal('fetch', async (request: Request) => {
    const path = new URL(request.url).pathname;
    if (path.endsWith('/staff-session')) {
      if (holdOuter) {
        holdOuter = false;
        return new Promise<Response>((resolve) => {
          finishOuter = resolve;
        });
      }
      probes += 1;
      if (probeFailure && probes > 2) return Response.json({ code: 'NOT_READY' }, { status: 503 });
      return Response.json(probes === 1 ? session : fresh);
    }
    if (path.endsWith('/branches'))
      return Response.json({
        items: [{ id: branch, name_ar: 'Branch', name_en: 'Branch', timezone: 'Asia/Kuwait' }],
      });
    if (refused) return Response.json({ code: 'UNAUTHENTICATED' }, { status: 401 });
    return Response.json({ items: [], next_cursor: null, request_branch_ids: [branch] });
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function RecoveryHost() {
  const state = useStaffLogin();
  return state.authenticatedSession ? (
    <>
      <p>{state.authenticatedSession.device_id}</p>
      <OwnLeaveEntry
        context={{
          mode: 'reception',
          timezone: 'Asia/Kuwait',
          ...state.authenticatedSession,
          sessionEpoch: state.epoch,
        }}
      />
    </>
  ) : (
    <p>Private session hidden</p>
  );
}
async function mountRefused() {
  const cache = new QueryClient();
  render(
    <QueryClientProvider client={cache}>
      <LocaleProvider locale="en" setLocale={() => undefined}>
        <RecoveryHost />
      </LocaleProvider>
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'My leave' }));
  await chooseBranch();
  fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-12-01' } });
  await waitFor(() => expect(cache.isFetching({ queryKey: ['my-leave'] })).toBe(0));
  refused = true;
  await act(async () => {
    await cache.refetchQueries({ queryKey: ['my-leave'] });
  });
  await screen.findByRole('button', { name: 'Retry' });
  expect(screen.queryByLabelText('From date')).toBeNull();
  refused = false;
  return cache;
}
async function chooseBranch() {
  await screen.findByLabelText('From date');
}

it.each(['2026-10-04T10:01:00Z'])(
  'applies the recovered shorter deadline %s while outer probes fail, including returning from background',
  async (expiresAt) => {
    const cache = await mountRefused();
    fresh.expires_at = expiresAt;
    probeFailure = true;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await chooseBranch();
    expect((cache.getQueryData(['staff-session', 0]) as typeof session).expires_at).toBe(
      fresh.expires_at,
    );
    await act(async () => {
      await cache.refetchQueries({ queryKey: ['staff-session'] });
    });
    expect(screen.getByLabelText('From date')).toBeTruthy();
    await act(async () => {
      vi.setSystemTime(new Date(fresh.expires_at));
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });
    await screen.findByText('Private session hidden');
    expect(screen.queryByLabelText('From date')).toBeNull();
    expect(cache.getQueriesData({ queryKey: ['my-leave'] })).toHaveLength(0);
  },
);

it('does not let an earlier outer probe replace the fresh recovered deadline', async () => {
  const cache = await mountRefused();
  holdOuter = true;
  let earlier: Promise<void> | undefined;
  act(() => {
    earlier = cache.refetchQueries({ queryKey: ['staff-session'] });
  });
  await waitFor(() => expect(finishOuter).toBeTypeOf('function'));
  fresh.expires_at = '2026-10-04T10:01:00Z';
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await chooseBranch();
  await act(async () => {
    finishOuter?.(Response.json(session));
    await earlier;
  });
  expect(screen.getByLabelText('From date')).toBeTruthy();
  expect((cache.getQueryData(['staff-session', 0]) as typeof session).expires_at).toBe(
    fresh.expires_at,
  );
});

it.each(['2099-10-04', '2099-10-04T10:00:00', '2099-02-31T10:00:00Z', '2026-10-04T09:00:00Z'])(
  'keeps private leave hidden when recovery returns invalid or elapsed expiry %s',
  async (expiresAt) => {
    const cache = await mountRefused();
    fresh.expires_at = expiresAt;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByText('Private session hidden')).toBeTruthy());
    expect(screen.queryByLabelText('From date')).toBeNull();
    expect(
      cache.getQueriesData({ queryKey: ['my-leave'] }).every(([, data]) => data === undefined),
    ).toBe(true);
    expect(cache.getQueryData(['staff-session', 0])).toBeNull();
  },
);

it('does not accept a different account during explicit recovery', async () => {
  const cache = await mountRefused();
  fresh.user_id = '10000000-0000-4000-8000-000000000007';
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(screen.getByText('Private session hidden')).toBeTruthy());
  expect(screen.queryByLabelText('From date')).toBeNull();
  expect(cache.getQueryData(['staff-session', 0])).toBeNull();
});
