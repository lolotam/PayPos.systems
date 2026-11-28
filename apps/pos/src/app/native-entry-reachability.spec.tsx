import { fireEvent, render, screen } from '@testing-library/react';
import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { readDeviceRole, readRememberedBusiness, saveDeviceRole } from '@/app/device-role';
import { LocaleProvider } from '@/shared/locale/locale-context';
import { readLaunchLink } from '@/shared/platform/launch-links';
import type * as NativeShellModule from '@/shared/platform/native-shell';

import { NativeEntry } from './native-entry';

vi.mock('@/app/device-role', () => ({
  clearDeviceRole: vi.fn(async () => undefined),
  connectEmployee: vi.fn(async () => undefined),
  readDeviceRole: vi.fn(async () => null),
  readRememberedBusiness: vi.fn(async () => null),
  rememberBusiness: vi.fn(async () => undefined),
  saveDeviceRole: vi.fn(async () => undefined),
}));
vi.mock('@/app/device-screen', () => ({ DeviceScreen: () => <h2>device screen</h2> }));
vi.mock('@/personal-staff/ui/personal-screen', () => ({
  PersonalScreen: () => <h2>personal screen</h2>,
}));
vi.mock('@/personal-staff/api/use-personal-session', () => ({
  usePersonalSession: () => ({
    epoch: 0,
    online: true,
    loading: false,
    confirmedNoSession: true,
    session: null,
    changed: vi.fn(),
    signOut: vi.fn(),
  }),
}));
vi.mock('@/shared/platform/launch-links', () => ({
  readLaunchLink: vi.fn(async () => null),
  markLaunchLinkHandled: vi.fn(),
  onLinkOpened: vi.fn(() => () => undefined),
}));
vi.mock('@/shared/platform/native-shell', async (importOriginal) => ({
  ...(await importOriginal<typeof NativeShellModule>()),
  usesNativeStaffTransport: vi.fn(() => false),
  nativePosHost: vi.fn(() => 'pos.staging.pospay.systems'),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VITE_API_URL', 'https://api.staging.pospay.systems');
  vi.mocked(readDeviceRole).mockResolvedValue(null);
  vi.mocked(readRememberedBusiness).mockResolvedValue(null);
  vi.mocked(readLaunchLink).mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function mountLocale(locale: 'ar' | 'en') {
  return render(
    <DirectionProvider dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <LocaleProvider locale={locale} setLocale={() => undefined}>
        <NativeEntry />
      </LocaleProvider>
    </DirectionProvider>,
  );
}

it.each(['ar', 'en'] as const)(
  'keeps StartScreen and shows %s needsInternet when captive portal or offline server check fails (#566)',
  async (locale) => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>portal</html>', { status: 200 })),
    );
    mountLocale(locale);

    fireEvent.click(await screen.findByRole('button', { name: t(locale, 'nativeShell.counter') }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(t(locale, 'nativeShell.needsInternet'));
    expect(screen.getByRole('heading', { name: t(locale, 'nativeShell.title') })).not.toBeNull();
    expect(screen.queryByRole('heading', { name: 'device screen' })).toBeNull();
    expect(saveDeviceRole).not.toHaveBeenCalled();
  },
);

it('proceeds to DeviceScreen and persists role once /health responds status ok (#566)', async () => {
  vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ status: 'ok' }, { status: 200 })),
  );
  mountLocale('en');

  fireEvent.click(await screen.findByRole('button', { name: t('en', 'nativeShell.counter') }));

  expect(await screen.findByRole('heading', { name: 'device screen' })).not.toBeNull();
  expect(saveDeviceRole).toHaveBeenCalledWith('counter');
});
