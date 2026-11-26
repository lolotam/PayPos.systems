import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { t, type Locale } from '@pospay/i18n';
import { LocaleProvider } from '@/shared/locale/locale-context';
import type * as NativeShellModule from '@/shared/platform/native-shell';
import { personalCalls } from '../api/personal-calls';
import { EnrolPasskeyScreen } from './enrol-passkey-screen';

const capabilities = vi.hoisted(() => ({
  value: { webPush: true, passkeys: true, qrScan: true, attendanceCamera: true },
}));

vi.mock('@/shared/platform/native-shell', async (importOriginal) => ({
  ...(await importOriginal<typeof NativeShellModule>()),
  capabilities: vi.fn(() => capabilities.value),
}));
vi.mock('../api/personal-calls', () => ({ personalCalls: { binding: vi.fn(), enrol: vi.fn() } }));
vi.mock('../push/push-control', () => ({ PushControl: () => null }));
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
beforeEach(() => {
  vi.clearAllMocks();
  capabilities.value = { webPush: true, passkeys: true, qrScan: true, attendanceCamera: true };
});
afterEach(() => {
  vi.unstubAllEnvs();
});

it('shows the register button when the build can enrol a passkey (MOB-T07)', async () => {
  vi.mocked(personalCalls.binding).mockResolvedValue({
    bound: false,
    binding_id: null,
    revision: null,
    bound_at: null,
  });
  const view = mount('ar');

  expect(await screen.findByRole('button', { name: t('ar', 'personalStaff.enrol') })).toBeDefined();
  expect(screen.queryByText(t('ar', 'nativeShell.webOnlyNotice'))).toBeNull();
  view.unmount();
});

it('shows the web app notice and no register button without passkeys (MOB-T05)', async () => {
  capabilities.value = { webPush: true, passkeys: false, qrScan: true, attendanceCamera: true };
  vi.stubEnv('VITE_NATIVE', '1');
  vi.stubEnv('VITE_POS_HOST', 'pos.staging.pospay.systems');
  vi.mocked(personalCalls.binding).mockResolvedValue({
    bound: false,
    binding_id: null,
    revision: null,
    bound_at: null,
  });
  const view = mount('ar');

  await screen.findByText(t('ar', 'personalStaff.unbound'));
  expect(screen.queryByRole('button', { name: t('ar', 'personalStaff.enrol') })).toBeNull();
  expect(screen.getByText(t('ar', 'nativeShell.webOnlyNotice'))).toBeDefined();
  const link = screen.getByRole('link', { name: t('ar', 'nativeShell.openWebApp') });
  expect(link.getAttribute('href')).toBe('https://pos.staging.pospay.systems/personal');
  view.unmount();
});
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
