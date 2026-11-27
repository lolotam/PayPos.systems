import { StrictMode, type ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  connectEmployee,
  readDeviceRole,
  readRememberedBusiness,
  rememberBusiness,
  saveDeviceRole,
} from '@/app/device-role';
import { LocaleProvider } from '@/shared/locale/locale-context';
import type * as NativeShellModule from '@/shared/platform/native-shell';

import { NativeEntry } from './native-entry';

const app = vi.hoisted(() => ({ getLaunchUrl: vi.fn(), addListener: vi.fn() }));

vi.mock('@capacitor/app', () => ({
  App: {
    getLaunchUrl: app.getLaunchUrl,
    addListener: app.addListener,
  },
}));
vi.mock('@/app/device-role', () => ({
  readDeviceRole: vi.fn(),
  readRememberedBusiness: vi.fn(),
  saveDeviceRole: vi.fn(),
  rememberBusiness: vi.fn(),
  connectEmployee: vi.fn(),
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
vi.mock('@/personal-staff/ui/personal-screen', () => ({
  PersonalScreen: ({
    workspace,
    notice,
  }: {
    workspace?: { company_id: string; business_id: string };
    notice?: ReactNode;
  }) => (
    <>
      <h2>personal screen</h2>
      {workspace ? <p>{`${workspace.company_id} ${workspace.business_id}`}</p> : null}
      {notice}
    </>
  ),
}));
vi.mock('@/shared/platform/native-shell', async (importOriginal) => ({
  ...(await importOriginal<typeof NativeShellModule>()),
  nativePosHost: vi.fn(() => 'pos.staging.pospay.systems'),
}));

const COMPANY = '00000000-0000-4000-8000-000000000001';
const BUSINESS = '00000000-0000-4000-8000-000000000002';
const LAUNCH_URL = `https://pos.staging.pospay.systems/personal?company=${COMPANY}&business=${BUSINESS}`;

function mountStrict() {
  return render(
    <StrictMode>
      <DirectionProvider dir="rtl">
        <LocaleProvider locale="ar" setLocale={() => undefined}>
          <NativeEntry />
        </LocaleProvider>
      </DirectionProvider>
    </StrictMode>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  vi.mocked(readDeviceRole).mockResolvedValue(null);
  vi.mocked(readRememberedBusiness).mockResolvedValue(null);
  vi.mocked(saveDeviceRole).mockResolvedValue(undefined);
  vi.mocked(rememberBusiness).mockResolvedValue(undefined);
  vi.mocked(connectEmployee).mockResolvedValue(undefined);
  app.addListener.mockResolvedValue({ remove: vi.fn() });
  app.getLaunchUrl.mockResolvedValue({ url: LAUNCH_URL });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useNativeLink cold start with real launch reader', () => {
  it('applies a launch link under React StrictMode and records only its fingerprint', async () => {
    mountStrict();

    expect(await screen.findByRole('heading', { name: 'personal screen' })).not.toBeNull();
    expect(screen.getByText(`${COMPANY} ${BUSINESS}`)).not.toBeNull();
    expect(connectEmployee).toHaveBeenCalledTimes(1);

    const stored = window.sessionStorage.getItem('pospay.native.launchUrl');
    expect(stored).not.toBeNull();
    expect(stored).not.toContain('pos.staging.pospay.systems');
    expect(stored).not.toContain(COMPANY);
  });

  it('keeps the launch link unconsumed when offline prevents connecting it', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    mountStrict();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(t('ar', 'nativeShell.needsInternet'));
    expect(window.sessionStorage.getItem('pospay.native.launchUrl')).toBeNull();
  });

  it('keeps the launch link unconsumed when reading storage fails on cold start', async () => {
    vi.mocked(readRememberedBusiness).mockRejectedValue(new Error('SYNTHETIC_READ_FAILURE'));
    mountStrict();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(t('ar', 'nativeShell.saveFailed'));
    expect(window.sessionStorage.getItem('pospay.native.launchUrl')).toBeNull();
  });
});
