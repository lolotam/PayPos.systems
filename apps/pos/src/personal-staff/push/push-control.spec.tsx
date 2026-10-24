import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { t } from '@pospay/i18n';

import { LocaleProvider } from '@/shared/locale/locale-context';
import { attendanceInstallationId } from '../model/installation-id';
import { PushControl } from './push-control';
import { PushKeyStaleError, pushCalls } from './push-calls';
import type { PushRecord } from './push-record';
import { refreshPush } from './push-refresh';
import { runSignInPushCheck } from './push-sign-in-check';

const fakes = vi.hoisted(() => {
  const state = {
    installationId: '12345678-1234-4234-8234-123456789abc',
    record: null as PushRecord | null,
    writes: [] as PushRecord[],
    removed: 0,
    permission: 'default' as 'default' | 'granted' | 'denied',
    requestedPermission: 'granted' as 'default' | 'granted' | 'denied',
    supported: true,
    ios: false,
    standalone: false,
    subscribed: false,
    subscribeCalls: 0,
    unsubscribeCalls: 0,
    permissionRequests: 0,
  };
  return { state };
});

const RECORD: PushRecord = {
  token: 'delivery-token',
  subscriber_ref: 'subscriber-ref',
  company_id: 'company',
  vapid_key_id: '0123456789abcdef',
  suspended: false,
};

vi.mock('../model/installation-id', () => ({
  attendanceInstallationId: vi.fn(() => fakes.state.installationId),
  INSTALLATION_KEY: 'pospay.attendance.installation',
  INSTALLATION_STORAGE_BLOCKED: 'INSTALLATION_STORAGE_BLOCKED',
}));

vi.mock('./push-refresh', () => ({
  refreshPush: vi.fn(async () => ({ kind: 'none' as const })),
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
      fakes.state.permissionRequests += 1;
      fakes.state.permission = fakes.state.requestedPermission;
      return fakes.state.permission;
    },
    currentSubscription: async () => (fakes.state.subscribed ? subscription() : null),
    subscribePush: async () => {
      fakes.state.subscribeCalls += 1;
      fakes.state.subscribed = true;
      return subscription();
    },
    unsubscribePush: async () => {
      fakes.state.unsubscribeCalls += 1;
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
    withTimeout: <T,>(promise: Promise<T>) => promise,
    pushCalls: { config: vi.fn(), register: vi.fn(), revoke: vi.fn() },
  };
});

const CONFIG = {
  vapid_public_key: 'public-key',
  vapid_key_id: '0123456789abcdef',
  subscriber_ref: 'subscriber-ref',
};

let onlineSpy: { mockRestore(): void } | null = null;

function mount() {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={cache}>
      <LocaleProvider locale="en" setLocale={() => undefined}>
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
  fakes.state.requestedPermission = 'granted';
  fakes.state.supported = true;
  fakes.state.ios = false;
  fakes.state.standalone = false;
  fakes.state.subscribed = false;
  fakes.state.subscribeCalls = 0;
  fakes.state.unsubscribeCalls = 0;
  fakes.state.permissionRequests = 0;
  vi.mocked(attendanceInstallationId).mockImplementation(() => fakes.state.installationId);
  vi.mocked(refreshPush).mockImplementation(async () => ({ kind: 'none' }));
  vi.mocked(pushCalls.config).mockResolvedValue({ kind: 'ready', config: CONFIG });
  vi.mocked(pushCalls.register).mockResolvedValue(undefined);
  vi.mocked(pushCalls.revoke).mockResolvedValue(undefined);
});

afterEach(() => {
  onlineSpy?.mockRestore();
  onlineSpy = null;
});

it('says this phone cannot receive notifications and shows no button', async () => {
  fakes.state.supported = false;
  mount();

  expect(await screen.findByText(t('en', 'staffPush.unsupported'))).toBeDefined();
  expect(screen.queryByRole('button', { name: t('en', 'staffPush.enable') })).toBeNull();
});

it('shows the home screen instruction instead of a toggle on an iPhone', async () => {
  fakes.state.supported = false;
  fakes.state.ios = true;
  mount();

  expect(await screen.findByText(t('en', 'staffPush.installLead'))).toBeDefined();
  expect(screen.getByText(t('en', 'staffPush.installStep2'))).toBeDefined();
  expect(screen.queryByRole('button', { name: t('en', 'staffPush.enable') })).toBeNull();
});

it('says notifications are blocked in the browser and shows no button', async () => {
  fakes.state.permission = 'denied';
  mount();

  expect(await screen.findByText(t('en', 'staffPush.blocked'))).toBeDefined();
  expect(screen.queryByRole('button', { name: t('en', 'staffPush.enable') })).toBeNull();
  expect(pushCalls.register).not.toHaveBeenCalled();
});

it('offers the turn on button while the notifications are off', async () => {
  mount();

  expect(await screen.findByText(t('en', 'staffPush.off'))).toBeDefined();
  const button = screen.getByRole('button', { name: t('en', 'staffPush.enable') });
  expect(button.hasAttribute('disabled')).toBe(false);
});

it('says the notifications are on and offers the turn off button', async () => {
  fakes.state.record = { ...RECORD };
  fakes.state.permission = 'granted';
  fakes.state.subscribed = true;
  mount();

  expect(await screen.findByText(t('en', 'staffPush.on'))).toBeDefined();
  expect(screen.getByRole('button', { name: t('en', 'staffPush.disable') })).toBeDefined();
});

it('disables the button and gives a reason while there is no connection', async () => {
  onlineSpy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  mount();

  expect(await screen.findByText(t('en', 'staffPush.offline'))).toBeDefined();
  const button = screen.getByRole('button', { name: t('en', 'staffPush.enable') });
  expect(button.hasAttribute('disabled')).toBe(true);
});

it('shows the blocked storage text and makes no call at all', async () => {
  vi.mocked(attendanceInstallationId).mockImplementation(() => {
    throw new Error('INSTALLATION_STORAGE_BLOCKED');
  });
  mount();

  expect(await screen.findByText(t('en', 'staffPush.storageBlocked'))).toBeDefined();
  expect(pushCalls.config).not.toHaveBeenCalled();
  expect(pushCalls.register).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: t('en', 'staffPush.enable') })).toBeNull();
});

it('shows nothing when the server has no push configuration', async () => {
  vi.mocked(pushCalls.config).mockResolvedValue({ kind: 'not-ready' });
  const view = mount();

  await waitFor(() => expect(pushCalls.config).toHaveBeenCalled());
  await act(async () => {});
  expect(screen.queryByText(t('en', 'staffPush.off'))).toBeNull();
  expect(screen.queryByRole('button', { name: t('en', 'staffPush.enable') })).toBeNull();
  view.unmount();
});

it('turns the notifications on with one registration and shows the notifications are on', async () => {
  const actual = await vi.importActual<typeof import('./push-refresh')>('./push-refresh');
  vi.mocked(refreshPush).mockImplementation(actual.refreshPush);
  mount();
  const button = await screen.findByRole('button', { name: t('en', 'staffPush.enable') });

  await act(async () => {
    fireEvent.click(button);
  });

  expect(await screen.findByText(t('en', 'staffPush.on'))).toBeDefined();
  expect(pushCalls.register).toHaveBeenCalledTimes(1);
  const body = vi.mocked(pushCalls.register).mock.calls[0]?.[0];
  expect(body?.installation_id).toBe(fakes.state.installationId);
  expect(body?.vapid_key_id).toBe('0123456789abcdef');
  expect(body?.delivery_token).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  expect(body?.locale).toBe('en');
  expect(fakes.state.writes[0]?.company_id).toBe('company');
  expect(fakes.state.writes[0]?.suspended).toBe(false);
});

it('turns the notifications off, removes the record and revokes the subscription', async () => {
  fakes.state.record = { ...RECORD };
  fakes.state.permission = 'granted';
  fakes.state.subscribed = true;
  mount();
  const button = await screen.findByRole('button', { name: t('en', 'staffPush.disable') });

  await act(async () => {
    fireEvent.click(button);
  });

  expect(await screen.findByText(t('en', 'staffPush.off'))).toBeDefined();
  expect(fakes.state.removed).toBe(1);
  expect(pushCalls.revoke).toHaveBeenCalledWith(fakes.state.installationId);
});

it('asks for the configuration again and retries once when the key is stale', async () => {
  vi.mocked(pushCalls.register)
    .mockRejectedValueOnce(new PushKeyStaleError())
    .mockResolvedValueOnce(undefined);
  mount();
  const button = await screen.findByRole('button', { name: t('en', 'staffPush.enable') });

  await act(async () => {
    fireEvent.click(button);
  });

  expect(await screen.findByText(t('en', 'staffPush.on'))).toBeDefined();
  expect(pushCalls.register).toHaveBeenCalledTimes(2);
});

it('shows the blocked state when the browser refuses the permission', async () => {
  fakes.state.requestedPermission = 'denied';
  mount();
  const button = await screen.findByRole('button', { name: t('en', 'staffPush.enable') });

  await act(async () => {
    fireEvent.click(button);
  });

  expect(await screen.findByText(t('en', 'staffPush.blocked'))).toBeDefined();
  expect(fakes.state.permissionRequests).toBe(1);
  expect(pushCalls.register).not.toHaveBeenCalled();
});

it('shows off and sends nothing when the record belongs to another company', async () => {
  fakes.state.record = { ...RECORD, company_id: 'another-company' };
  fakes.state.permission = 'granted';
  fakes.state.subscribed = true;
  mount();

  expect(await screen.findByText(t('en', 'staffPush.off'))).toBeDefined();
  expect(pushCalls.register).not.toHaveBeenCalled();
});

it('shows the invitation once and keeps it away after it is dismissed', async () => {
  const view = mount();

  expect(await screen.findByText(t('en', 'staffPush.invitationLead'))).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staffPush.invitationDismiss') }));

  await waitFor(() => expect(screen.queryByText(t('en', 'staffPush.invitationLead'))).toBeNull());
  expect(localStorage.getItem('pospay.push.invitationSeen')).toBe('1');
  view.unmount();

  mount();
  expect(await screen.findByText(t('en', 'staffPush.off'))).toBeDefined();
  expect(screen.queryByText(t('en', 'staffPush.invitationLead'))).toBeNull();
});

it('shows on after the sign-in check restores a record that was suspended', async () => {
  fakes.state.record = { ...RECORD, suspended: true };
  fakes.state.permission = 'granted';
  fakes.state.subscribed = true;
  mount();
  expect(await screen.findByText(t('en', 'staffPush.reconnecting'))).toBeDefined();

  await act(async () => {
    await runSignInPushCheck();
  });

  expect(await screen.findByText(t('en', 'staffPush.on'))).toBeDefined();
  expect(screen.queryByText(t('en', 'staffPush.reconnecting'))).toBeNull();
});

it('runs the rotation when the served key changes while the screen stays open', async () => {
  fakes.state.record = { ...RECORD };
  fakes.state.permission = 'granted';
  fakes.state.subscribed = true;
  const view = mount();
  await screen.findByText(t('en', 'staffPush.on'));
  await waitFor(() => expect(refreshPush).toHaveBeenCalledTimes(1));

  vi.mocked(pushCalls.config).mockResolvedValue({
    kind: 'ready',
    config: { ...CONFIG, vapid_key_id: 'fedcba9876543210' },
  });
  await act(async () => {
    await view.cache.invalidateQueries({ queryKey: ['staff-push-config'] });
  });

  await waitFor(() => expect(refreshPush).toHaveBeenCalledTimes(2));
  expect(vi.mocked(refreshPush).mock.calls[1]?.[0]?.config.vapid_key_id).toBe('fedcba9876543210');
});
