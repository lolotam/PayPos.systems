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
    permission: 'default' as 'default' | 'granted' | 'denied',
    supported: true,
    ios: false,
    standalone: false,
    subscribed: false,
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
    read: async () => fakes.state.record,
    write: async (record: PushRecord) => {
      fakes.state.record = record;
      fakes.state.writes.push(record);
    },
    remove: async () => {
      fakes.state.removed += 1;
      fakes.state.record = null;
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
  fakes.state.permission = 'default';
  fakes.state.supported = true;
  fakes.state.ios = false;
  fakes.state.standalone = false;
  fakes.state.subscribed = false;
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
