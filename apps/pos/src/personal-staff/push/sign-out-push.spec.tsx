import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import { usePersonalSession } from '../api/use-personal-session';
import { personalCalls } from '../api/personal-calls';
import { observePersonalChange } from '../model/session-change';
import { runPushExclusive } from './push-lock';
import type { PushRecord } from './push-record';

const fakes = vi.hoisted(() => {
  const state = {
    removed: 0,
    unsubscribed: 0,
    revokeAttempts: 0,
    generation: 0,
    suspendOnRemove: false,
    record: null as PushRecord | null,
  };
  return { state };
});

const RECORD: PushRecord = {
  token: 'delivery-token',
  subscriber_ref: 'subscriber-ref',
  company_id: 'company',
  vapid_key_id: '0123456789abcdef',
  suspended: false,
  revision: 0,
};

const session = {
  user_id: 'user',
  employee_id: 'employee',
  company_id: 'company',
  business_id: 'business',
  expires_at: '2026-10-04T12:00:00Z',
};

vi.mock('../api/personal-calls', () => ({ personalCalls: { session: vi.fn(), signOut: vi.fn() } }));
vi.mock('../model/session-change', () => ({
  observePersonalChange: vi.fn(() => () => undefined),
  announcePersonalChange: vi.fn(),
}));
vi.mock('../model/installation-id', () => ({
  attendanceInstallationId: vi.fn(() => '12345678-1234-4234-8234-123456789abc'),
  INSTALLATION_KEY: 'pospay.attendance.installation',
  INSTALLATION_STORAGE_BLOCKED: 'INSTALLATION_STORAGE_BLOCKED',
}));
vi.mock('./push-browser', () => ({
  unsubscribePush: async () => {
    fakes.state.unsubscribed += 1;
    return true;
  },
}));
vi.mock('./push-record-idb', () => ({
  pushRecordStore: {
    read: async () => (fakes.state.record === null ? null : { ...fakes.state.record }),
    write: async () => undefined,
    remove: async () => {
      fakes.state.removed += 1;
      if (fakes.state.suspendOnRemove) {
        // موظفة تانية دخلت على نفس الموبايل: سجلها الجديد اتعلق.
        fakes.state.record = { ...RECORD, token: 'another-token', suspended: true, revision: 1 };
        return;
      }
      fakes.state.record = null;
    },
    removeIfMatches: async (expected: { token: string | null; revision: number }) => {
      const stored = fakes.state.record;
      if (
        stored === null ||
        stored.token !== expected.token ||
        stored.revision !== expected.revision
      ) {
        return false;
      }
      fakes.state.removed += 1;
      fakes.state.record = null;
      return true;
    },
    suspend: async () => null,
    generation: async () => fakes.state.generation,
    bumpGeneration: async () => {
      fakes.state.generation += 1;
      return fakes.state.generation;
    },
    writeIfGeneration: async () => true,
  },
}));
vi.mock('./push-calls', () => ({
  pushCalls: {
    config: vi.fn(),
    register: vi.fn(),
    revoke: vi.fn(async () => {
      fakes.state.revokeAttempts += 1;
      throw new Error('PUSH_REVOKE_REFUSED');
    }),
  },
  withTimeout: <T,>(promise: Promise<T>) => promise,
  withAbortTimeout: <T,>(run: (signal: AbortSignal) => Promise<T>) =>
    run(new AbortController().signal),
}));

let onlineSpy: { mockRestore(): void } | null = null;

function fixture() {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={cache}>{children}</QueryClientProvider>
  );
  return { cache, ...renderHook(() => usePersonalSession(), { wrapper }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.state.removed = 0;
  fakes.state.unsubscribed = 0;
  fakes.state.revokeAttempts = 0;
  fakes.state.generation = 0;
  fakes.state.suspendOnRemove = false;
  fakes.state.record = null;
  vi.mocked(personalCalls.session).mockResolvedValue(session);
  vi.mocked(personalCalls.signOut).mockResolvedValue(undefined);
});

afterEach(() => {
  onlineSpy?.mockRestore();
  onlineSpy = null;
});

it('removes the local record on an explicit sign out even when the revoke fails', async () => {
  const f = fixture();
  await waitFor(() => expect(f.result.current.session).toEqual(session));
  vi.mocked(personalCalls.session).mockResolvedValue(null);

  await act(async () => {
    await f.result.current.signOut();
  });

  expect(personalCalls.signOut).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(f.result.current.session).toBeNull());
  expect(fakes.state.removed).toBeGreaterThanOrEqual(1);
  expect(fakes.state.unsubscribed).toBe(1);
  expect(fakes.state.revokeAttempts).toBe(1);
  f.unmount();
});

it('removes the record on sign out even when another push operation holds the lock', async () => {
  const f = fixture();
  await waitFor(() => expect(f.result.current.session).toEqual(session));
  vi.mocked(personalCalls.session).mockResolvedValue(null);
  let release = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const holding = runPushExclusive(() => held);

  let signingOut: Promise<void> = Promise.resolve();
  await act(async () => {
    signingOut = f.result.current.signOut();
  });
  await waitFor(() => expect(fakes.state.removed).toBeGreaterThanOrEqual(1));
  expect(personalCalls.signOut).not.toHaveBeenCalled();

  release();
  await act(async () => {
    await signingOut;
  });
  expect(personalCalls.signOut).toHaveBeenCalledTimes(1);
  await holding;
  f.unmount();
});

it('does not revoke or unsubscribe when another employee signed in meanwhile', async () => {
  const f = fixture();
  await waitFor(() => expect(f.result.current.session).toEqual(session));
  vi.mocked(personalCalls.session).mockResolvedValue(null);
  fakes.state.suspendOnRemove = true;

  await act(async () => {
    await f.result.current.signOut();
  });

  expect(personalCalls.signOut).toHaveBeenCalledTimes(1);
  expect(fakes.state.revokeAttempts).toBe(0);
  expect(fakes.state.unsubscribed).toBe(0);
  f.unmount();
});

it('keeps a new record written while sign-out cleanup is queued', async () => {
  const f = fixture();
  await waitFor(() => expect(f.result.current.session).toEqual(session));
  vi.mocked(personalCalls.session).mockResolvedValue(null);
  fakes.state.record = { ...RECORD };
  let release = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const holding = runPushExclusive(() => held);

  let signingOut: Promise<void> = Promise.resolve();
  await act(async () => {
    signingOut = f.result.current.signOut();
  });
  await waitFor(() => expect(fakes.state.record).toBeNull());
  fakes.state.record = { ...RECORD, token: 'new-token', revision: 1 };

  release();
  await act(async () => {
    await signingOut;
  });
  await holding;

  expect(f.result.current.session).toBeNull();
  expect(fakes.state.record).toEqual({ ...RECORD, token: 'new-token', revision: 1 });
  expect(fakes.state.revokeAttempts).toBe(0);
  expect(fakes.state.unsubscribed).toBe(0);
  f.unmount();
});

it('leaves the record alone when the session is only replaced', async () => {
  const f = fixture();
  await waitFor(() => expect(f.result.current.session).toEqual(session));

  await act(async () => {
    vi.mocked(observePersonalChange).mock.calls[0]?.[0]();
  });

  await waitFor(() => expect(f.result.current.session).toBeNull());
  expect(fakes.state.removed).toBe(0);
  expect(fakes.state.unsubscribed).toBe(0);
  f.unmount();
});

it('leaves the record alone when the session expired', async () => {
  const f = fixture();
  await waitFor(() => expect(f.result.current.session).toEqual(session));
  vi.mocked(personalCalls.session).mockResolvedValue(null);

  await act(async () => {
    await f.cache.invalidateQueries({ queryKey: ['personal-session'] });
  });

  await waitFor(() => expect(f.result.current.session).toBeNull());
  expect(fakes.state.removed).toBe(0);
  expect(fakes.state.unsubscribed).toBe(0);
  f.unmount();
});

it('leaves the record alone when the phone goes offline', async () => {
  const f = fixture();
  await waitFor(() => expect(f.result.current.session).toEqual(session));
  onlineSpy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

  await act(async () => {
    window.dispatchEvent(new Event('offline'));
  });

  expect(f.result.current.session).toBeNull();
  expect(fakes.state.removed).toBe(0);
  expect(fakes.state.unsubscribed).toBe(0);
  f.unmount();
});
