import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { t } from '@pospay/i18n';

import { LocaleProvider } from '@/shared/locale/locale-context';
import { PushControl } from './push-control';
import { pushCalls } from './push-calls';
import type { PushRecord } from './push-record';
import { refreshPush } from './push-refresh';
import type * as PushRefreshModule from './push-refresh';

const DELIVERY = 'test-delivery-a';
const CONFIG_A = {
  vapid_public_key: 'public-key',
  vapid_key_id: '0123456789abcdef',
  subscriber_ref: 'person-a',
  company_id: 'company',
};
// نفس الموظفة في شركة تانية: مرجع المشترك واحد، بس هوية الجلسة اتغيرت.
const CONFIG_B = { ...CONFIG_A, company_id: 'company-b' };
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
    suspend: async () => {
      const stored = fakes.record;
      if (stored === null) return null;
      const suspended = { ...stored, suspended: true, revision: stored.revision + 1 };
      fakes.record = suspended;
      return { record: suspended, generation: 0 };
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
// التحديث الحقيقي بيتشغّل، بس بيتحسب عدد مراته: التحديث ما يشتغلش في حلقة.
vi.mock('./push-refresh', async (importOriginal) => {
  const actual = await importOriginal<typeof PushRefreshModule>();
  return { refreshPush: vi.fn(actual.refreshPush) };
});

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

/** طلبات الإعدادات من شاشة الموظف (من غير إشارة): الطلب الأول والمعيد بعد الجلسة اتغيرت. */
function screenRequests(): number {
  return vi.mocked(pushCalls.config).mock.calls.filter((call) => call[0] === undefined).length;
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

it('shows the suspended state after the session changed', async () => {
  const view = mount();

  expect(await screen.findByText(t('en', 'staffPush.reconnecting'))).toBeDefined();
  expect(screen.getByText(t('en', 'staffPush.off'))).toBeDefined();
  expect(screen.queryByText(t('en', 'staffPush.on'))).toBeNull();
  expect(fakes.record?.revision).toBe(RECORD_A.revision + 1);
  expect(screen.getByRole('button', { name: t('en', 'staffPush.enable') })).toBeDefined();
  expect(pushCalls.register).not.toHaveBeenCalled();
  // الإعدادات اتطلبت من الشاشة مرة واحدة بس زيادة، والتحديث ما اشتغلش في حلقة.
  await waitFor(() => expect(screenRequests()).toBe(2));
  expect(vi.mocked(refreshPush).mock.calls.length).toBeLessThanOrEqual(2);
  view.unmount();
});
