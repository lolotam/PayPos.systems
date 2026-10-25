import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { t } from '@pospay/i18n';

import { LocaleProvider } from '@/shared/locale/locale-context';
import { PushControl } from './push-control';
import type * as PushBrowserModule from './push-browser';
import type { PushRecordStore } from './push-record';
import { refreshPush } from './push-refresh';

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
    read: async () => null,
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

// supportsPush بيفضل حقيقي: الاختبار بيتأكد إن المتصفح من غير قفل بين التبويبات
// بيتعامل كغير داعم، فباقي دوال المتصفح بس هي اللي بتتسخّ.
vi.mock('./push-browser', async (importOriginal) => ({
  ...(await importOriginal<typeof PushBrowserModule>()),
  notificationPermission: () => 'default' as const,
  currentSubscription: async () => null,
  isIosDevice: () => false,
  isStandalone: () => true,
}));

/** متصفح بحالة locks معيّنة: القفل هو الفرق بين زر شغال وزر بيقفل. */
function stubBrowser(withLocks: boolean): void {
  vi.stubGlobal('navigator', {
    serviceWorker: {},
    ...(withLocks ? { locks: { request: async () => undefined } } : {}),
  });
  vi.stubGlobal('PushManager', function PushManager() {});
  vi.stubGlobal('Notification', function Notification() {});
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
});

it('offers the turn on button when the browser has a cross tab lock', async () => {
  stubBrowser(true);

  mount();

  expect(await screen.findByText(t('en', 'staffPush.off'))).toBeDefined();
  expect(screen.getByRole('button', { name: t('en', 'staffPush.enable') })).toBeDefined();
});
