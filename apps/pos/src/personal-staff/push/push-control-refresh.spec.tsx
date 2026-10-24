import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { t } from '@pospay/i18n';

import { LocaleProvider } from '@/shared/locale/locale-context';
import { attendanceInstallationId } from '../model/installation-id';
import { PushControl } from './push-control';
import { pushCalls } from './push-calls';
import type { PushRecord } from './push-record';

const fakes = vi.hoisted(() => {
  const state = {
    installationId: '12345678-1234-4234-8234-123456789abc',
    record: null as PushRecord | null,
    writes: [] as PushRecord[],
    removed: 0,
    generation: 0,
    permission: 'default' as 'default' | 'granted' | 'denied',
    supported: true,
    ios: false,
    standalone: false,
    subscribed: false,
    suspendOnWrite: false,
  };
  return { state };
});

const CONFIG = {
  vapid_public_key: 'public-key',
  vapid_key_id: '0123456789abcdef',
  subscriber_ref: 'subscriber-ref',
};

vi.mock('../model/installation-id', () => ({
  attendanceInstallationId: vi.fn(() => fakes.state.installationId),
  INSTALLATION_KEY: 'pospay.attendance.installation',
  INSTALLATION_STORAGE_BLOCKED: 'INSTALLATION_STORAGE_BLOCKED',
}));

vi.mock('./push-record-idb', () => ({
  pushRecordStore: {
    read: async () => (fakes.state.record === null ? null : { ...fakes.state.record }),
    write: async (record: PushRecord) => {
      fakes.state.record = record;
      fakes.state.writes.push(record);
    },
    suspend: async (record: PushRecord) => {
      fakes.state.record = {
        ...record,
        suspended: true,
        revision: (fakes.state.record?.revision ?? 0) + 1,
      };
      fakes.state.writes.push(fakes.state.record);
    },
    remove: async () => {
      fakes.state.removed += 1;
      fakes.state.record = null;
    },
    generation: async () => fakes.state.generation,
    bumpGeneration: async () => {
      fakes.state.generation += 1;
      return fakes.state.generation;
    },
    writeIfGeneration: async (
      record: PushRecord,
      expected: number,
      options?: { clearSuspension?: boolean; expectRevision?: number },
    ) => {
      if (fakes.state.generation !== expected) return false;
      const stored = fakes.state.record;
      if (
        options?.expectRevision !== undefined &&
        (stored?.revision ?? 0) !== options.expectRevision
      ) {
        return false;
      }
      const clear = options?.clearSuspension === true;
      const suspended = (stored?.suspended === true || fakes.state.suspendOnWrite) && !clear;
      fakes.state.record = suspended ? { ...record, suspended: true } : record;
      fakes.state.writes.push(fakes.state.record);
      return true;
    },
  },
}));

vi.mock('./push-browser', () => {
  const subscription = () => ({
    endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic',
    unsubscribe: async () => true,
    toJSON: () => ({
      endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic',
      expirationTime: null,
      keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) },
    }),
  });
  return {
    hasServiceWorker: () => fakes.state.supported,
    hasPushManager: () => fakes.state.supported,
    hasNotification: () => fakes.state.supported,
    supportsPush: () => fakes.state.supported,
    isIosDevice: () => fakes.state.ios,
    isStandalone: () => fakes.state.standalone,
    notificationPermission: () => fakes.state.permission,
    requestNotificationPermission: async () => {
      fakes.state.permission = 'granted';
      return 'granted' as const;
    },
    currentSubscription: async () => (fakes.state.subscribed ? subscription() : null),
    subscribePush: async () => {
      fakes.state.subscribed = true;
      return subscription();
    },
    subscribeWithDeadline: async () => {
      fakes.state.subscribed = true;
      return subscription();
    },
    unsubscribePush: async () => {
      fakes.state.subscribed = false;
      return true;
    },
    base64UrlToBytes: () => new Uint8Array([1, 2, 3]),
    pushSubscriptionBody: () => ({
      endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic',
      expirationTime: null,
      keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) },
    }),
  };
});

vi.mock('./push-calls', () => {
  class PushKeyStaleError extends Error {
    constructor() {
      super('PUSH_KEY_STALE');
      this.name = 'PushKeyStaleError';
    }
  }
  return {
    PushKeyStaleError,
    pushCalls: { config: vi.fn(), register: vi.fn(), revoke: vi.fn() },
    withTimeout: <T,>(promise: Promise<T>) => promise,
    withAbortTimeout: <T,>(run: (signal: AbortSignal) => Promise<T>) =>
      run(new AbortController().signal),
  };
});

function mount(locale: 'ar' | 'en' = 'en') {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={cache}>
      <LocaleProvider locale={locale} setLocale={() => undefined}>
        <PushControl companyId="company" />
      </LocaleProvider>
    </QueryClientProvider>,
  );
  return { cache, ...view };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  fakes.state.record = null;
  fakes.state.writes = [];
  fakes.state.removed = 0;
  fakes.state.generation = 0;
  fakes.state.permission = 'default';
  fakes.state.supported = true;
  fakes.state.ios = false;
  fakes.state.standalone = false;
  fakes.state.subscribed = false;
  fakes.state.suspendOnWrite = false;
  vi.mocked(attendanceInstallationId).mockImplementation(() => fakes.state.installationId);
  vi.mocked(pushCalls.config).mockResolvedValue({ kind: 'ready', config: CONFIG });
  vi.mocked(pushCalls.register).mockResolvedValue(undefined);
  vi.mocked(pushCalls.revoke).mockResolvedValue(undefined);
});

it('registers the language again when the app language changes', async () => {
  const view = mount();
  const button = await screen.findByRole('button', { name: t('en', 'staffPush.enable') });
  await act(async () => {
    fireEvent.click(button);
  });
  expect(await screen.findByText(t('en', 'staffPush.on'))).toBeDefined();
  expect(pushCalls.register).toHaveBeenCalledTimes(1);

  await act(async () => {
    view.rerender(
      <QueryClientProvider client={view.cache}>
        <LocaleProvider locale="ar" setLocale={() => undefined}>
          <PushControl companyId="company" />
        </LocaleProvider>
      </QueryClientProvider>,
    );
  });

  await waitFor(() => expect(pushCalls.register).toHaveBeenCalledTimes(2));
  expect(vi.mocked(pushCalls.register).mock.calls[1]?.[0]?.locale).toBe('ar');
});

it('runs the rotation when the served key changes after enabling', async () => {
  const view = mount();
  const button = await screen.findByRole('button', { name: t('en', 'staffPush.enable') });
  await act(async () => {
    fireEvent.click(button);
  });
  expect(await screen.findByText(t('en', 'staffPush.on'))).toBeDefined();

  vi.mocked(pushCalls.config).mockResolvedValue({
    kind: 'ready',
    config: { ...CONFIG, vapid_key_id: 'fedcba9876543210' },
  });
  await act(async () => {
    await view.cache.invalidateQueries({ queryKey: ['staff-push-config'] });
  });

  await waitFor(() => expect(pushCalls.register).toHaveBeenCalledTimes(2));
  expect(vi.mocked(pushCalls.register).mock.calls[1]?.[0]?.vapid_key_id).toBe('fedcba9876543210');
});

it('reads the permission again when the window comes back', async () => {
  fakes.state.permission = 'denied';
  mount();
  expect(await screen.findByText(t('en', 'staffPush.blocked'))).toBeDefined();

  fakes.state.permission = 'granted';
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
  });

  expect(await screen.findByText(t('en', 'staffPush.off'))).toBeDefined();
  expect(screen.queryByText(t('en', 'staffPush.blocked'))).toBeNull();
});

it('shows the home screen instruction on an iPhone that is not installed', async () => {
  fakes.state.ios = true;
  fakes.state.standalone = false;
  mount();

  expect(await screen.findByText(t('en', 'staffPush.installLead'))).toBeDefined();
  expect(screen.queryByRole('button', { name: t('en', 'staffPush.enable') })).toBeNull();
});

it('tries the registration once when the refresh keeps failing, and again after a focus', async () => {
  fakes.state.record = {
    token: 'delivery-token',
    subscriber_ref: 'subscriber-ref',
    company_id: 'company',
    vapid_key_id: '0123456789abcdef',
    suspended: false,
    revision: 0,
  };
  fakes.state.permission = 'granted';
  fakes.state.subscribed = true;
  vi.mocked(pushCalls.register).mockRejectedValue(new Error('SYNTHETIC_NETWORK_FAILURE'));
  mount();

  expect(await screen.findByText(t('en', 'staffPush.on'))).toBeDefined();
  await waitFor(() => expect(pushCalls.register).toHaveBeenCalledTimes(1));
  await act(async () => {});
  expect(pushCalls.register).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(t('en', 'staffPush.error'))).toBeNull();

  await act(async () => {
    window.dispatchEvent(new Event('focus'));
  });

  await waitFor(() => expect(pushCalls.register).toHaveBeenCalledTimes(2));
  expect(screen.getByText(t('en', 'staffPush.on'))).toBeDefined();
});

it('turns the notifications on over a suspended record and ends unsuspended', async () => {
  fakes.state.record = {
    token: 'delivery-token',
    subscriber_ref: 'subscriber-ref',
    company_id: 'company',
    vapid_key_id: '0123456789abcdef',
    suspended: true,
    revision: 0,
  };
  // أول جواب للـ config مختلف: التحديث وقت الفتح ما يرجعش السجل قبل التشغيل.
  let configCalls = 0;
  vi.mocked(pushCalls.config).mockImplementation(async () => {
    configCalls += 1;
    return configCalls === 1
      ? { kind: 'ready', config: { ...CONFIG, subscriber_ref: 'another-ref' } }
      : { kind: 'ready', config: CONFIG };
  });
  mount();
  const button = await screen.findByRole('button', { name: t('en', 'staffPush.enable') });

  await act(async () => {
    fireEvent.click(button);
  });

  expect(await screen.findByText(t('en', 'staffPush.on'))).toBeDefined();
  expect(fakes.state.record?.suspended).toBe(false);
});

it('keeps a suspension that appears while the notifications are being turned on', async () => {
  fakes.state.suspendOnWrite = true;
  mount();
  const button = await screen.findByRole('button', { name: t('en', 'staffPush.enable') });

  await act(async () => {
    fireEvent.click(button);
  });

  expect(fakes.state.record?.suspended).toBe(true);
  expect(await screen.findByText(t('en', 'staffPush.reconnecting'))).toBeDefined();
});

it('runs the refresh again after the browser permission is granted', async () => {
  fakes.state.record = {
    token: 'delivery-token',
    subscriber_ref: 'subscriber-ref',
    company_id: 'company',
    vapid_key_id: '0123456789abcdef',
    suspended: false,
    revision: 0,
  };
  fakes.state.permission = 'default';
  fakes.state.subscribed = true;
  mount();

  expect(await screen.findByText(t('en', 'staffPush.off'))).toBeDefined();
  expect(pushCalls.register).not.toHaveBeenCalled();

  fakes.state.permission = 'granted';
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
  });

  await waitFor(() => expect(pushCalls.register).toHaveBeenCalledTimes(1));
});

it('starts no second refresh while one is still pending', async () => {
  fakes.state.record = {
    token: 'delivery-token',
    subscriber_ref: 'subscriber-ref',
    company_id: 'company',
    vapid_key_id: '0123456789abcdef',
    suspended: false,
    revision: 0,
  };
  fakes.state.permission = 'granted';
  fakes.state.subscribed = true;
  vi.mocked(pushCalls.register).mockImplementation(() => new Promise<void>(() => undefined));
  mount();

  expect(await screen.findByText(t('en', 'staffPush.on'))).toBeDefined();
  await waitFor(() => expect(pushCalls.register).toHaveBeenCalledTimes(1));
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('focus'));
  });

  expect(pushCalls.register).toHaveBeenCalledTimes(1);
  const turnOff = screen.getByRole('button', { name: t('en', 'staffPush.disable') });
  expect(turnOff.hasAttribute('disabled')).toBe(false);
  expect(screen.queryByText(t('en', 'staffPush.error'))).toBeNull();
});
