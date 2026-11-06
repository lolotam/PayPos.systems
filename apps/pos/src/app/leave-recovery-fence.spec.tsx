import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { usePersonalSession } from '@/personal-staff/api/use-personal-session';
import { useStaffLogin } from '@/staff-login/api/use-staff-login';
import type { LeaveContext } from '@/my-leave/model/context';
import { recoverLeaveSession } from './recover-leave-session';

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const common = {
  company_id: id(1),
  business_id: id(2),
  user_id: id(3),
  expires_at: '2026-10-04T12:00:00Z',
};
const personal = { ...common, employee_id: id(4) };
const staff = { ...common, branch_id: id(5), device_id: id(6) };
type Mode = 'personal' | 'reception';
let cache: QueryClient;
let mode: Mode;
let response: unknown;
let finish: (() => void) | undefined;
let held: boolean;
let probeStarted: ((release: () => void) => void) | undefined;
let controller: AbortController;
let recovery: Promise<unknown>;
let failure: boolean;

beforeEach(() => {
  vi.stubGlobal('BroadcastChannel', undefined);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-04T10:00:00Z'));
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  cache = new QueryClient();
  controller = new AbortController();
  held = false;
  failure = false;
  finish = undefined;
  probeStarted = undefined;
  vi.stubGlobal('fetch', async (request: Request) => {
    if (new URL(request.url).pathname.endsWith('-session')) {
      if (held)
        await new Promise<void>((resolve) => {
          finish = resolve;
          probeStarted?.(resolve);
        });
      if (failure) throw new TypeError('Synthetic offline');
      return response === null ? Response.json({}, { status: 401 }) : Response.json(response);
    }
    return Response.json({ items: [], next_cursor: null, request_branch_ids: [id(5)] });
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
vi.mock('@/shared/api/device-auth', () => ({ currentDeviceToken: async () => 'synthetic-device' }));

function PersonalHost() {
  const state = usePersonalSession();
  return <Host session={state.session} epoch={state.epoch} logout={state.changed} />;
}
function StaffHost() {
  const state = useStaffLogin();
  return <Host session={state.authenticatedSession} epoch={state.epoch} logout={state.changed} />;
}
function Host({
  session,
  epoch,
  logout,
}: {
  session: typeof common | null;
  epoch: number;
  logout: () => void;
}) {
  const [result, setResult] = useState('idle');
  return (
    <>
      <p>{session?.user_id ?? 'Private session hidden'}</p>
      <p>{result}</p>
      <button onClick={logout}>Logout</button>
      <button
        onClick={() => {
          const context: LeaveContext = {
            mode,
            ...(mode === 'personal' ? personal : staff),
            sessionEpoch: epoch,
          };
          recovery = recoverLeaveSession(context, '', controller.signal, cache).then(
            () => setResult('recovered'),
            () => setResult('rejected'),
          );
        }}
      >
        Recover
      </button>
    </>
  );
}
async function mount(currentMode: Mode) {
  onlineManager.setOnline(true);
  mode = currentMode;
  response = mode === 'personal' ? personal : staff;
  render(
    <QueryClientProvider client={cache}>
      {mode === 'personal' ? <PersonalHost /> : <StaffHost />}
    </QueryClientProvider>,
  );
  await screen.findByText(common.user_id);
  cache.setQueryData(['other-private'], 'old private');
}
const sessionKey = () => [mode === 'personal' ? 'personal-session' : 'staff-session', 0];

it.each(['personal', 'reception'] as const)(
  '%s null cleanup tolerates repeated rejection but preserves a newer live session',
  async (currentMode) => {
    for (const replacement of ['null', 'live']) {
      await mount(currentMode);
      const cancel = cache.cancelQueries.bind(cache);
      let release: (() => void) | undefined;
      vi.spyOn(cache, 'cancelQueries').mockImplementation(async (...args) => {
        await cancel(...args);
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      });
      act(() => {
        cache.setQueryData(sessionKey(), null);
      });
      await screen.findByText('Private session hidden');
      await waitFor(() => expect(release).toBeTypeOf('function'));
      const newer = { ...(currentMode === 'personal' ? personal : staff), user_id: id(9) };
      await act(async () => {
        cache.setQueryData(sessionKey(), replacement === 'null' ? null : newer);
        if (replacement === 'live') cache.setQueryData(['other-private'], 'new private');
        release?.();
      });
      if (replacement === 'null') {
        await waitFor(() => expect(cache.getQueryData(['other-private'])).toBeUndefined());
        expect(screen.getByText('Private session hidden')).toBeTruthy();
      } else {
        await screen.findByText(newer.user_id);
        expect(cache.getQueryData(['other-private'])).toBe('new private');
      }
      cleanup();
      cache.clear();
      vi.restoreAllMocks();
    }
  },
);

it.each(['personal', 'reception'] as const)(
  '%s stale displayed context cannot adopt a newer cache revision at retry start',
  async (currentMode) => {
    await mount(currentMode);
    const original = currentMode === 'personal' ? personal : staff;
    const newer = { ...original, user_id: id(9) };
    response = newer;
    await act(async () => {
      cache.setQueryData(sessionKey(), newer);
      cache.setQueryData(['other-private'], 'new private');
      await expect(
        recoverLeaveSession(
          { mode: currentMode, ...original, sessionEpoch: 0 },
          '',
          controller.signal,
          cache,
        ),
      ).rejects.toMatchObject({ name: 'AbortError' });
    });
    await screen.findByText(newer.user_id);
    expect(cache.getQueryData(sessionKey())).toEqual(newer);
    expect(cache.getQueryData(['other-private'])).toBe('new private');
  },
);

it.each(['personal', 'reception'] as const)(
  '%s authoritative rejection clears outer identity and other private caches',
  async (currentMode) => {
    for (const rejected of [
      null,
      { ...common, user_id: id(9) },
      { ...common, expires_at: 'bad' },
      { ...common, expires_at: '2026-10-04T09:00:00Z' },
    ]) {
      await mount(currentMode);
      response =
        rejected === null
          ? null
          : { ...(currentMode === 'personal' ? personal : staff), ...rejected };
      fireEvent.click(screen.getByText('Recover'));
      await screen.findByText('Private session hidden');
      await waitFor(() => expect(cache.getQueryData(['other-private'])).toBeUndefined());
      expect(cache.getQueryData(sessionKey())).toBeNull();
      cleanup();
      cache.clear();
    }
  },
);

it.each(['personal', 'reception'] as const)(
  '%s late failure and success cannot replace newer session with or without abort',
  async (currentMode) => {
    for (const outcome of ['null', 'success', 'network'])
      for (const abort of [false, true]) {
        await mount(currentMode);
        held = true;
        response = outcome === 'null' ? null : mode === 'personal' ? personal : staff;
        failure = outcome === 'network';
        finish = undefined;
        probeStarted = undefined;
        const started = new Promise<() => void>((resolve) => {
          probeStarted = resolve;
        });
        fireEvent.click(screen.getByText('Recover'));
        const releaseProbe = await started;
        expect(finish).toBeTypeOf('function');
        const newer = { ...(mode === 'personal' ? personal : staff), user_id: id(8) };
        await act(async () => {
          cache.setQueryData(sessionKey(), newer);
          cache.setQueryData(['other-private'], 'new private');
          if (abort) controller.abort();
          releaseProbe();
          await recovery;
        });
        await screen.findByText(newer.user_id);
        expect(cache.getQueryData(sessionKey())).toEqual(newer);
        expect(cache.getQueryData(['other-private'])).toBe('new private');
        cleanup();
        cache.clear();
        held = false;
        failure = false;
        controller = new AbortController();
      }
  },
);

it.each(['personal', 'reception'] as const)(
  '%s abort during cancel preserves newer private state',
  async (currentMode) => {
    await mount(currentMode);
    let release: (() => void) | undefined;
    const original = cache.cancelQueries.bind(cache);
    vi.spyOn(cache, 'cancelQueries').mockImplementation(async (...args) => {
      await original(...args);
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    fireEvent.click(screen.getByText('Recover'));
    await waitFor(() => expect(release).toBeTypeOf('function'));
    const newer = { ...(mode === 'personal' ? personal : staff), user_id: id(8) };
    await act(async () => {
      controller.abort();
      cache.setQueryData(sessionKey(), newer);
      cache.setQueryData(['other-private'], 'new private');
      release?.();
      await recovery;
    });
    await screen.findByText(newer.user_id);
    expect(cache.getQueryData(['other-private'])).toBe('new private');
  },
);

it.each(['personal', 'reception'] as const)(
  '%s closed, logged-out and offline recovery cannot revive the old epoch',
  async (currentMode) => {
    for (const event of ['close', 'logout', 'offline']) {
      await mount(currentMode);
      held = true;
      finish = undefined;
      probeStarted = undefined;
      const started = new Promise<() => void>((resolve) => {
        probeStarted = resolve;
      });
      fireEvent.click(screen.getByText('Recover'));
      const releaseProbe = await started;
      expect(finish).toBeTypeOf('function');
      await act(async () => {
        if (event === 'close') controller.abort();
        else if (event === 'logout') {
          response = null;
          held = false;
          fireEvent.click(screen.getByText('Logout'));
        } else {
          Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
          window.dispatchEvent(new Event('offline'));
        }
        releaseProbe();
        await recovery;
      });
      await screen.findByText('rejected');
      if (event === 'close') expect(screen.getByText(common.user_id)).toBeTruthy();
      else {
        await screen.findByText('Private session hidden');
        expect(cache.getQueryData(sessionKey())).toBeUndefined();
        expect(cache.getQueryData(['other-private'])).toBeUndefined();
      }
      cleanup();
      cache.clear();
      held = false;
      controller = new AbortController();
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    }
  },
);
