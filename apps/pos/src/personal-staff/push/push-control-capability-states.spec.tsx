import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { t } from '@pospay/i18n';

import { LocaleProvider } from '@/shared/locale/locale-context';
import { PushControl } from './push-control';
import type * as PushBrowserModule from './push-browser';
import type { PushRecord, PushRecordStore } from './push-record';
import { refreshPush } from './push-refresh';

const OWN = 'test-own-a';
const REPLACED = 'test-replaced-b';
const EXISTING_ENDPOINT = 'https://fcm.googleapis.com/fcm/send/existing';

const fakes = vi.hoisted(() => ({
  record: null as PushRecord | null,
  subscribed: false,
  permission: 'default' as 'default' | 'granted' | 'denied',
  readFails: false,
  generation: 0,
  removed: 0,
  unsubscribes: 0,
  revokes: 0,
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
    read: async () => {
      if (fakes.readFails) throw new Error('PUSH_STORE_UNAVAILABLE');
      return fakes.record === null ? null : { ...fakes.record };
    },
    write: async (record: PushRecord) => {
      fakes.record = record;
    },
    remove: async () => {
      fakes.removed += 1;
      fakes.record = null;
    },
    removeIfMatches: async (expected: { token: string | null; revision: number }) => {
      const stored = fakes.record;
      if (
        stored === null ||
        stored.token !== expected.token ||
        stored.revision !== expected.revision
      ) {
        return false;
      }
      fakes.removed += 1;
      fakes.record = null;
      return true;
    },
    suspend: async () => null,
    generation: async () => fakes.generation,
    bumpGeneration: async () => {
      fakes.generation += 1;
      return fakes.generation;
    },
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
        company_id: 'company',
      },
    })),
    register: vi.fn(),
    revoke: vi.fn(async () => {
      fakes.revokes += 1;
    }),
  },
  PushKeyStaleError: class PushKeyStaleError extends Error {},
  withTimeout: <T,>(promise: Promise<T>) => promise,
  withAbortTimeout: <T,>(run: (signal: AbortSignal) => Promise<T>) =>
    run(new AbortController().signal),
}));

// supportsPush و canEnablePush بيفضلوا حقيقيين: الاختبار بيتأكد إن زرار الإيقاف بيمشي
// على لقطة السجل المعروضة، فباقي دوال المتصفح بس هي اللي بتتسخّ.
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
  unsubscribePush: vi.fn(async () => {
    fakes.unsubscribes += 1;
    return true;
  }),
  isIosDevice: () => false,
  isStandalone: () => true,
}));

/** متصفح بحالة locks معيّنة: القفل هو الفرق بين زر تشغيل وزر إيقاف. */
function stubBrowser(withLocks: boolean): void {
  vi.stubGlobal('navigator', {
    serviceWorker: {},
    onLine: true,
    ...(withLocks
      ? { locks: { request: async (_name: string, work: () => Promise<unknown>) => work() } }
      : {}),
  });
  vi.stubGlobal('PushManager', function PushManager() {});
  vi.stubGlobal('Notification', function Notification() {});
}

/** سجل الشركة دي على الموبايل: موجود أو معلّق. */
function ownRecord(token: string, suspended = false): PushRecord {
  return {
    token,
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
  fakes.readFails = false;
  fakes.generation = 0;
  fakes.removed = 0;
  fakes.unsubscribes = 0;
  fakes.revokes = 0;
  vi.mocked(refreshPush).mockImplementation(async () => ({ kind: 'none' }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it('does not touch a record another tab replaced before the click', async () => {
  stubBrowser(true);
  fakes.subscribed = true;
  fakes.permission = 'granted';
  fakes.record = ownRecord(OWN);

  mount();

  const button = await screen.findByRole('button', { name: t('en', 'staffPush.disable') });
  // تبويب تاني غيّر السجل قبل ما الضغطة توصل القفل.
  fakes.record = ownRecord(REPLACED);
  await act(async () => {
    fireEvent.click(button);
  });

  expect(fakes.unsubscribes).toBe(0);
  expect(fakes.revokes).toBe(0);
  expect(fakes.removed).toBe(0);
  expect(fakes.record?.token).toBe(REPLACED);
  expect(await screen.findByText(t('en', 'staffPush.on'))).toBeDefined();
});

it('shows the turn on button only for a suspended own record', async () => {
  stubBrowser(true);
  fakes.subscribed = true;
  fakes.permission = 'granted';
  fakes.record = ownRecord(OWN, true);

  mount();

  expect(await screen.findByText(t('en', 'staffPush.reconnecting'))).toBeDefined();
  expect(screen.getByRole('button', { name: t('en', 'staffPush.enable') })).toBeDefined();
  expect(screen.queryByRole('button', { name: t('en', 'staffPush.disable') })).toBeNull();
});

it('shows the turn off button only when the browser blocked the notifications', async () => {
  stubBrowser(true);
  fakes.subscribed = true;
  fakes.permission = 'denied';
  fakes.record = ownRecord(OWN);

  mount();

  expect(await screen.findByText(t('en', 'staffPush.blocked'))).toBeDefined();
  expect(screen.getByRole('button', { name: t('en', 'staffPush.disable') })).toBeDefined();
  expect(screen.queryByRole('button', { name: t('en', 'staffPush.enable') })).toBeNull();
});

it('shows no turn off button when the record could not be read', async () => {
  stubBrowser(false);
  fakes.subscribed = true;
  fakes.permission = 'granted';
  fakes.readFails = true;

  mount();

  expect(await screen.findByText(t('en', 'staffPush.storageBlocked'))).toBeDefined();
  expect(screen.queryByRole('button', { name: t('en', 'staffPush.disable') })).toBeNull();
  expect(screen.queryByRole('button', { name: t('en', 'staffPush.enable') })).toBeNull();
});

it('shows no button at all when the record could not be read on a lock capable browser', async () => {
  stubBrowser(true);
  fakes.subscribed = true;
  fakes.permission = 'granted';
  fakes.readFails = true;

  mount();

  expect(await screen.findByText(t('en', 'staffPush.storageBlocked'))).toBeDefined();
  expect(screen.queryByRole('button', { name: t('en', 'staffPush.disable') })).toBeNull();
  expect(screen.queryByRole('button', { name: t('en', 'staffPush.enable') })).toBeNull();
});
