import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { t, type Locale } from '@pospay/i18n';
import { LocaleProvider } from '@/shared/locale/locale-context';
import { personalCalls } from '../api/personal-calls';
import { EnrolPasskeyScreen } from './enrol-passkey-screen';
vi.mock('../api/personal-calls', () => ({ personalCalls: { binding: vi.fn(), enrol: vi.fn() } }));
vi.mock('../push/push-browser', () => ({
  hasServiceWorker: () => false,
  hasPushManager: () => false,
  hasNotification: () => false,
  supportsPush: () => false,
  isIosDevice: () => false,
  isStandalone: () => false,
  notificationPermission: () => 'default' as const,
  requestNotificationPermission: async () => 'default' as const,
  currentSubscription: async () => null,
  subscribePush: async () => ({
    endpoint: '',
    unsubscribe: async () => true,
    toJSON: () => ({ endpoint: '', keys: { p256dh: '', auth: '' } }),
  }),
  unsubscribePush: async () => false,
  base64UrlToBytes: () => new Uint8Array(),
  pushSubscriptionBody: () => ({
    endpoint: '',
    expirationTime: null,
    keys: { p256dh: '', auth: '' },
  }),
}));
vi.mock('../push/push-calls', () => {
  class PushApiError extends Error {
    constructor(readonly code: string) {
      super(code);
      this.name = 'PushApiError';
    }
  }
  class PushKeyStaleError extends PushApiError {
    constructor() {
      super('PUSH_KEY_STALE');
      this.name = 'PushKeyStaleError';
    }
  }
  class PushRegistrationBusyError extends PushApiError {
    constructor() {
      super('PUSH_REGISTRATION_BUSY');
      this.name = 'PushRegistrationBusyError';
    }
  }
  class PushRateLimitedError extends PushApiError {
    constructor() {
      super('RATE_LIMITED');
      this.name = 'PushRateLimitedError';
    }
  }
  return {
    PushApiError,
    PushKeyStaleError,
    PushRegistrationBusyError,
    PushRateLimitedError,
    withTimeout: <T,>(promise: Promise<T>) => promise,
    pushCalls: {
      config: vi.fn(async () => ({ kind: 'not-ready' as const })),
      register: vi.fn(async () => undefined),
      revoke: vi.fn(async () => undefined),
    },
  };
});
vi.mock('../push/push-record-idb', () => ({
  pushRecordStore: {
    read: async () => null,
    write: async () => undefined,
    remove: async () => undefined,
  },
}));
function mount(locale: Locale) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={cache}>
      <LocaleProvider locale={locale} setLocale={() => undefined}>
        <EnrolPasskeyScreen
          employeeId="synthetic"
          companyId="00000000-0000-4000-8000-000000000001"
          onSignOut={async () => undefined}
        />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}
beforeEach(() => vi.clearAllMocks());
it.each(['ar', 'en'] as const)(
  'an existing binding refuses replacement in %s UI',
  async (locale) => {
    vi.mocked(personalCalls.binding).mockResolvedValue({
      bound: true,
      binding_id: 'synthetic',
      revision: 1,
      bound_at: '2026-10-04T00:00:00Z',
    });
    const view = mount(locale);
    await screen.findByText(t(locale, 'personalStaff.bound'));
    expect(screen.queryByRole('button', { name: t(locale, 'personalStaff.enrol') })).toBeNull();
    expect(personalCalls.enrol).not.toHaveBeenCalled();
    view.unmount();
  },
);
it('cancelling WebAuthn shows a translated error and keeps first enrollment available', async () => {
  vi.mocked(personalCalls.binding).mockResolvedValue({
    bound: false,
    binding_id: null,
    revision: null,
    bound_at: null,
  });
  vi.mocked(personalCalls.enrol).mockRejectedValue(new Error('SYNTHETIC_CANCEL'));
  const view = mount('ar');
  const button = await screen.findByRole('button', { name: t('ar', 'personalStaff.enrol') });
  fireEvent.click(button);
  await screen.findByRole('alert');
  expect(screen.getByRole('alert').textContent).toBe(t('ar', 'errors.PASSKEY_INVALID'));
  await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
  view.unmount();
});

it.each(['ar', 'en'] as const)('phone enrollment refusals stop retry in %s', async (locale) => {
  for (const [code, message] of [
    ['PASSKEY_DEVICE_TAKEN', 'errors.PASSKEY_DEVICE_TAKEN'],
    ['PASSKEY_OTHER_DEVICE', 'errors.PASSKEY_OTHER_DEVICE'],
  ] as const) {
    vi.mocked(personalCalls.binding).mockResolvedValue({
      bound: false,
      binding_id: null,
      revision: null,
      bound_at: null,
    });
    vi.mocked(personalCalls.enrol).mockRejectedValue(new Error(code));
    const view = mount(locale);
    const button = await screen.findByRole('button', { name: t(locale, 'personalStaff.enrol') });
    fireEvent.click(button);
    await screen.findByRole('alert');
    expect(screen.getByRole('alert').textContent).toBe(t(locale, message));
    expect(button.hasAttribute('disabled')).toBe(true);
    view.unmount();
  }
});

it('blocked storage shows the storage message and keeps enrollment retryable', async () => {
  vi.mocked(personalCalls.binding).mockResolvedValue({
    bound: false,
    binding_id: null,
    revision: null,
    bound_at: null,
  });
  vi.mocked(personalCalls.enrol).mockRejectedValue(new Error('INSTALLATION_STORAGE_BLOCKED'));
  const view = mount('ar');
  const button = await screen.findByRole('button', { name: t('ar', 'personalStaff.enrol') });
  fireEvent.click(button);
  await screen.findByRole('alert');
  expect(screen.getByRole('alert').textContent).toBe(t('ar', 'personalAttendance.storageBlocked'));
  await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
  view.unmount();
});
