import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { t } from '@pospay/i18n';

import { LocaleProvider } from '@/shared/locale/locale-context';
import { PushControl } from './push-control';
import type * as PushBrowserModule from './push-browser';
import type { PushRecord, PushRecordStore } from './push-record';
import { refreshPush } from './push-refresh';

const EXISTING = 'test-existing-d';
const EXISTING_ENDPOINT = 'https://fcm.googleapis.com/fcm/send/existing';

const fakes = vi.hoisted(() => ({
  record: null as PushRecord | null,
  subscribed: false,
  permission: 'default' as 'default' | 'granted' | 'denied',
}));

vi.mock('../model/installation-id', () => ({
  attendanceInstallationId: vi.fn(() => '12345678-1234-4234-8234-123456789abc'),
  INSTALLATION_KEY: 'pospay.attendance.installation',
  INSTALLATION_STORAGE_BLOCKED: 'INSTALLATION_STORAGE_BLOCKED',
}));

vi.mock('./push-refresh', () => ({
  refreshPush: vi.fn(async () => ({ kind: 'none' as const })),
}));

vi.mock('./push-record-idb', () => ({
  pushRecordStore: {
    read: async () => (fakes.record === null ? null : { ...fakes.record }),
    write: async () => undefined,
    remove: async () => undefined,
    removeIfMatches: async () => false,
    suspend: async () => null,
    generation: async () => 0,
    bumpGeneration: async () => 1,
    writeIfGeneration: async () => true,
  } satisfies PushRecordStore,
}));

vi.mock('./push-calls', () => ({
  pushCalls: {
    config: vi.fn(async () => ({
      kind: 'ready' as const,
      config: {
        vapid_public_key: 'public-key',
        vapid_key_id: '0123456789abcdef',
        subscriber_ref: 'subscriber-ref',
      },
    })),
    register: vi.fn(),
    revoke: vi.fn(),
  },
  PushKeyStaleError: class PushKeyStaleError extends Error {},
  withTimeout: <T,>(promise: Promise<T>) => promise,
  withAbortTimeout: <T,>(run: (signal: AbortSignal) => Promise<T>) =>
    run(new AbortController().signal),
}));

// supportsPush و canEnablePush بيفضلوا حقيقيين: الاختبار بيتأكد إن المتصفح من غير قفل
// بين التبويبات بيفضل يقدر يوقّف الإشعارات، فباقي دوال المتصفح بس هي اللي بتتسخّ.
vi.mock('./push-browser', async (importOriginal) => ({
  ...(await importOriginal<typeof PushBrowserModule>()),
  notificationPermission: () => fakes.permission,
  currentSubscription: async () =>
    fakes.subscribed
      ? {
          endpoint: EXISTING_ENDPOINT,
          unsubscribe: async () => true,
          toJSON: () => ({
            endpoint: EXISTING_ENDPOINT,
            expirationTime: null,
            keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) },
          }),
        }
      : null,
  isIosDevice: () => false,
  isStandalone: () => true,
}));

/** متصفح بحالة locks معيّنة: القفل هو الفرق بين زر تشغيل وزر إيقاف. */
function stubBrowser(withLocks: boolean): void {
  vi.stubGlobal('navigator', {
    serviceWorker: {},
    ...(withLocks
      ? { locks: { request: async (_name: string, work: () => Promise<unknown>) => work() } }
      : {}),
  });
  vi.stubGlobal('PushManager', function PushManager() {});
  vi.stubGlobal('Notification', function Notification() {});
}

/** سجل الشركة دي على الموبايل: موجود أو معلّق. */
function ownRecord(suspended: boolean): PushRecord {
  return {
    token: EXISTING,
    subscriber_ref: 'subscriber-ref',
    company_id: 'company',
    vapid_key_id: '0123456789abcdef',
    suspended,
    revision: suspended ? 1 : 0,
  };
}

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
  fakes.record = null;
  fakes.subscribed = false;
  fakes.permission = 'default';
  vi.mocked(refreshPush).mockImplementation(async () => ({ kind: 'none' }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it('says the browser is unsupported when there is no cross tab lock', async () => {
  stubBrowser(false);

  mount();

  expect(await screen.findByText(t('en', 'staffPush.unsupported'))).toBeDefined();
  expect(screen.queryByRole('button', { name: t('en', 'staffPush.enable') })).toBeNull();
  expect(screen.queryByRole('button', { name: t('en', 'staffPush.disable') })).toBeNull();
});

it('shows the notifications on and the turn off button for an own subscription', async () => {
  stubBrowser(false);
  fakes.subscribed = true;
  fakes.permission = 'granted';
  fakes.record = ownRecord(false);

  mount();

  expect(await screen.findByText(t('en', 'staffPush.on'))).toBeDefined();
  expect(screen.getByRole('button', { name: t('en', 'staffPush.disable') })).toBeDefined();
});

it('shows off and reconnecting for a suspended own record and keeps the turn off button', async () => {
  stubBrowser(false);
  fakes.subscribed = true;
  fakes.permission = 'granted';
  fakes.record = ownRecord(true);

  mount();

  expect(await screen.findByText(t('en', 'staffPush.off'))).toBeDefined();
  expect(screen.getByText(t('en', 'staffPush.reconnecting'))).toBeDefined();
  expect(screen.getByRole('button', { name: t('en', 'staffPush.disable') })).toBeDefined();
  expect(screen.queryByRole('button', { name: t('en', 'staffPush.enable') })).toBeNull();
  expect(screen.queryByText(t('en', 'staffPush.on'))).toBeNull();
});

it('shows blocked and keeps the turn off button when the browser denied the notifications', async () => {
  stubBrowser(false);
  fakes.subscribed = true;
  fakes.permission = 'denied';
  fakes.record = ownRecord(false);

  mount();

  expect(await screen.findByText(t('en', 'staffPush.blocked'))).toBeDefined();
  expect(screen.getByRole('button', { name: t('en', 'staffPush.disable') })).toBeDefined();
  expect(screen.queryByRole('button', { name: t('en', 'staffPush.enable') })).toBeNull();
});

it('offers the turn on button when the browser has a cross tab lock', async () => {
  stubBrowser(true);

  mount();

  expect(await screen.findByText(t('en', 'staffPush.off'))).toBeDefined();
  expect(screen.getByRole('button', { name: t('en', 'staffPush.enable') })).toBeDefined();
});
