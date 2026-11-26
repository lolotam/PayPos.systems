import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { t } from '@pospay/i18n';

import { LocaleProvider } from '@/shared/locale/locale-context';
import type * as NativeShellModule from '@/shared/platform/native-shell';

import { PushControl } from './push-control';
import { pushCalls } from './push-calls';

const capabilities = vi.hoisted(() => ({
  value: { webPush: true, passkeys: true, qrScan: true, attendanceCamera: true },
}));

vi.mock('@/shared/platform/native-shell', async (importOriginal) => ({
  ...(await importOriginal<typeof NativeShellModule>()),
  capabilities: vi.fn(() => capabilities.value),
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
    revoke: vi.fn(),
  },
  PushKeyStaleError: class PushKeyStaleError extends Error {},
  withTimeout: <T,>(promise: Promise<T>) => promise,
  withAbortTimeout: <T,>(run: (signal: AbortSignal) => Promise<T>) =>
    run(new AbortController().signal),
}));

vi.mock('./push-browser', () => ({
  hasServiceWorker: () => true,
  hasPushManager: () => true,
  hasNotification: () => true,
  supportsPush: () => true,
  canEnablePush: () => true,
  isIosDevice: () => false,
  isStandalone: () => true,
  notificationPermission: () => 'default',
  requestNotificationPermission: async () => 'default',
  currentSubscription: async () => null,
  subscribePush: async () => null,
  subscribeWithDeadline: async () => null,
  unsubscribePush: async () => true,
  base64UrlToBytes: () => new Uint8Array([1, 2, 3]),
  pushSubscriptionBody: () => ({ endpoint: 'synthetic', expirationTime: null, keys: {} }),
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
  },
}));

vi.mock('../model/installation-id', () => ({
  attendanceInstallationId: vi.fn(() => '12345678-1234-4234-8234-123456789abc'),
  INSTALLATION_KEY: 'pospay.attendance.installation',
  INSTALLATION_STORAGE_BLOCKED: 'INSTALLATION_STORAGE_BLOCKED',
}));

vi.mock('./push-refresh', () => ({
  refreshPush: vi.fn(async () => ({ kind: 'none' as const })),
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
  capabilities.value = { webPush: true, passkeys: true, qrScan: true, attendanceCamera: true };
});

afterEach(() => {
  vi.unstubAllEnvs();
});

it('shows the web app notice and no push control without web push (MOB-T06)', () => {
  capabilities.value = { webPush: false, passkeys: true, qrScan: true, attendanceCamera: true };
  vi.stubEnv('VITE_NATIVE', '1');
  vi.stubEnv('VITE_POS_HOST', 'pos.staging.pospay.systems');

  mount();

  expect(screen.getByText(t('en', 'nativeShell.webOnlyNotice'))).toBeDefined();
  const link = screen.getByRole('link', { name: t('en', 'nativeShell.openWebApp') });
  expect(link.getAttribute('href')).toBe('https://pos.staging.pospay.systems/personal');
  expect(screen.queryByRole('button', { name: t('en', 'staffPush.enable') })).toBeNull();
  expect(screen.queryByRole('button', { name: t('en', 'staffPush.disable') })).toBeNull();
  expect(screen.queryByText(t('en', 'staffPush.off'))).toBeNull();
  expect(pushCalls.config).not.toHaveBeenCalled();
});

it('keeps the push control on screen when web push is open (MOB-T07)', async () => {
  mount();

  expect(await screen.findByText(t('en', 'staffPush.off'))).toBeDefined();
  expect(screen.getByRole('button', { name: t('en', 'staffPush.enable') })).toBeDefined();
  expect(screen.queryByText(t('en', 'nativeShell.webOnlyNotice'))).toBeNull();
});
