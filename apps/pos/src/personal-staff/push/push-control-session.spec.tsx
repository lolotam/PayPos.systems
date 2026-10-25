import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { t } from '@pospay/i18n';

import { LocaleProvider } from '@/shared/locale/locale-context';
import { PushControl } from './push-control';
import { pushCalls } from './push-calls';
import type { PushRecord } from './push-record';

const DELIVERY = 'test-delivery-a';
const CONFIG_A = {
  vapid_public_key: 'public-key',
  vapid_key_id: '0123456789abcdef',
  subscriber_ref: 'person-a',
};
const CONFIG_B = { ...CONFIG_A, subscriber_ref: 'person-b' };
const RECORD_A: PushRecord = {
  token: DELIVERY,
  subscriber_ref: 'person-a',
  company_id: 'company',
  vapid_key_id: CONFIG_A.vapid_key_id,
  suspended: false,
  revision: 0,
};

const fakes = vi.hoisted(() => ({
  record: null as PushRecord | null,
  subscribed: true,
}));

vi.mock('../model/installation-id', () => ({
  attendanceInstallationId: vi.fn(() => '12345678-1234-4234-8234-123456789abc'),
  INSTALLATION_KEY: 'pospay.attendance.installation',
  INSTALLATION_STORAGE_BLOCKED: 'INSTALLATION_STORAGE_BLOCKED',
}));
vi.mock('./push-lock', () => ({
  hasCrossTabLock: () => true,
  runPushExclusive: <T,>(work: () => Promise<T>) => work(),
}));
vi.mock('./push-record-events', () => ({
  notifyPushRecordChanged: vi.fn(),
  onPushRecordChanged: vi.fn(() => () => undefined),
}));
vi.mock('./push-record-idb', () => ({
  pushRecordStore: {
    generation: async () => 0,
    read: async () => (fakes.record === null ? null : { ...fakes.record }),
    remove: async () => {
      fakes.record = null;
    },
    writeIfGeneration: async (record: PushRecord) => {
      fakes.record = record;
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
    supportsPush: () => true,
    canEnablePush: () => true,
    isIosDevice: () => false,
    isStandalone: () => true,
    notificationPermission: () => 'granted' as const,
    requestNotificationPermission: async () => 'granted' as const,
    currentSubscription: async () => (fakes.subscribed ? subscription() : null),
    subscribeWithDeadline: async () => subscription(),
    unsubscribePush: async () => {
      fakes.subscribed = false;
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
vi.mock('./push-calls', () => ({
  PushKeyStaleError: class PushKeyStaleError extends Error {},
  pushCalls: { config: vi.fn(), register: vi.fn(), revoke: vi.fn() },
  withAbortTimeout: <T,>(run: (signal: AbortSignal) => Promise<T>) =>
    run(new AbortController().signal),
}));

function mount() {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={cache}>
      <LocaleProvider locale="en" setLocale={() => undefined}>
        <PushControl companyId="company" />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  fakes.record = { ...RECORD_A };
  fakes.subscribed = true;
  vi.mocked(pushCalls.config)
    .mockResolvedValueOnce({ kind: 'ready', config: CONFIG_A })
    .mockResolvedValue({ kind: 'ready', config: CONFIG_B });
  vi.mocked(pushCalls.register).mockResolvedValue(undefined);
  vi.mocked(pushCalls.revoke).mockResolvedValue(undefined);
});

it('shows the new session off state after a stale refresh is refused', async () => {
  const view = mount();

  expect(await screen.findByText(t('en', 'staffPush.off'))).toBeDefined();
  await waitFor(() => expect(pushCalls.config).toHaveBeenCalledTimes(4));
  expect(screen.getByRole('button', { name: t('en', 'staffPush.enable') })).toBeDefined();
  expect(screen.queryByText(t('en', 'staffPush.on'))).toBeNull();
  expect(fakes.record).toBeNull();
  expect(pushCalls.register).not.toHaveBeenCalled();
  view.unmount();
});
