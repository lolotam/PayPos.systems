import { act, render, screen } from '@testing-library/react';
import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  connectEmployee,
  readDeviceRole,
  readRememberedBusiness,
  rememberBusiness,
  type DeviceRole,
} from '@/app/device-role';
import type { PersonalWorkspace } from '@/app/manager-link';
import { LocaleProvider } from '@/shared/locale/locale-context';
import { readLaunchLink } from '@/shared/platform/launch-links';

import { NativeEntry } from './native-entry';

const opened = vi.hoisted(() => ({ listener: null as ((url: string) => void) | null }));

vi.mock('@/app/device-role', () => ({
  readDeviceRole: vi.fn(),
  readRememberedBusiness: vi.fn(),
  saveDeviceRole: vi.fn(),
  rememberBusiness: vi.fn(),
  connectEmployee: vi.fn(),
}));
vi.mock('@/app/device-screen', () => ({
  DeviceScreen: () => <h2>device screen</h2>,
}));
vi.mock('@/personal-staff/ui/personal-screen', () => ({
  PersonalScreen: ({ workspace }: { workspace?: { company_id: string; business_id: string } }) => (
    <>
      <h2>personal screen</h2>
      {workspace ? <p>{`${workspace.company_id} ${workspace.business_id}`}</p> : null}
    </>
  ),
}));
vi.mock('@/shared/platform/launch-links', () => ({
  readLaunchLink: vi.fn(),
  onLinkOpened: vi.fn((listener: (url: string) => void) => {
    opened.listener = listener;
    return () => undefined;
  }),
}));
vi.mock('@/shared/platform/native-shell', () => ({
  nativePosHost: vi.fn(() => 'pos.staging.pospay.systems'),
}));

const HOST = 'pos.staging.pospay.systems';
const COMPANY = '00000000-0000-4000-8000-000000000001';
const BUSINESS = '00000000-0000-4000-8000-000000000002';
const OTHER_BUSINESS = '00000000-0000-4000-8000-000000000003';
const link = (host = HOST, business = BUSINESS) =>
  `https://${host}/personal?company=${COMPANY}&business=${business}`;

function mount() {
  render(
    <DirectionProvider dir="rtl">
      <LocaleProvider locale="ar" setLocale={() => undefined}>
        <NativeEntry />
      </LocaleProvider>
    </DirectionProvider>,
  );
}

function prepare() {
  vi.clearAllMocks();
  opened.listener = null;
  vi.mocked(readDeviceRole).mockResolvedValue(null);
  vi.mocked(readRememberedBusiness).mockResolvedValue(null);
  vi.mocked(readLaunchLink).mockResolvedValue(null);
  vi.mocked(saveDeviceRole).mockResolvedValue(undefined);
  vi.mocked(rememberBusiness).mockResolvedValue(undefined);
  vi.mocked(connectEmployee).mockResolvedValue(undefined);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('NativeEntry links that race', () => {
  beforeEach(prepare);

  it('keeps the flow a warm link opened when the pending start read lands later', async () => {
    let release!: (value: string | null) => void;
    vi.mocked(readLaunchLink).mockReturnValue(
      new Promise<string | null>((resolve) => {
        release = resolve;
      }),
    );
    mount();

    await act(async () => {
      opened.listener?.(link());
    });
    expect(await screen.findByRole('heading', { name: 'personal screen' })).not.toBeNull();

    await act(async () => {
      release(null);
    });
    expect(screen.getByRole('heading', { name: 'personal screen' })).not.toBeNull();
    expect(screen.queryByRole('heading', { name: t('ar', 'nativeShell.title') })).toBeNull();
  });

  it('handles two links one after another and keeps the first business', async () => {
    let storedRole: DeviceRole | null = null;
    let storedBusiness: PersonalWorkspace | null = null;
    vi.mocked(readDeviceRole).mockImplementation(async () => storedRole);
    vi.mocked(readRememberedBusiness).mockImplementation(async () => storedBusiness);
    vi.mocked(connectEmployee).mockImplementation(async (workspace) => {
      storedRole = 'employee';
      storedBusiness = workspace;
    });
    mount();

    await act(async () => {
      opened.listener?.(link(HOST, BUSINESS));
      opened.listener?.(link(HOST, OTHER_BUSINESS));
    });

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(t('ar', 'nativeShell.otherBusiness'));
    expect(connectEmployee).toHaveBeenCalledTimes(1);
    expect(connectEmployee).toHaveBeenCalledWith({
      company_id: COMPANY,
      business_id: BUSINESS,
    });
    expect(screen.getByText(`${COMPANY} ${BUSINESS}`)).not.toBeNull();
  });
});

describe('NativeEntry refused links', () => {
  beforeEach(prepare);

  it('keeps the employee flow and warns when the business cannot be stored', async () => {
    vi.mocked(readDeviceRole).mockResolvedValue('employee');
    vi.mocked(readRememberedBusiness).mockResolvedValue(null);
    vi.mocked(rememberBusiness).mockRejectedValue(new Error('SYNTHETIC_SAVE_FAILURE'));
    vi.mocked(readLaunchLink).mockResolvedValue(link());
    mount();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(t('ar', 'nativeShell.saveFailed'));
    expect(screen.getByRole('heading', { name: 'personal screen' })).not.toBeNull();
  });

  it('keeps the start screen and asks the manager for a foreign warm link', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: t('ar', 'nativeShell.title') })).not.toBeNull();

    await act(async () => {
      opened.listener?.(link('pos.example.com'));
    });

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(t('ar', 'personalStaff.linkRequired'));
    expect(screen.getByRole('heading', { name: t('ar', 'nativeShell.title') })).not.toBeNull();
    expect(connectEmployee).not.toHaveBeenCalled();
    expect(rememberBusiness).not.toHaveBeenCalled();
  });

  it('shows no alert for a refused link when the employee has no business yet', async () => {
    vi.mocked(readDeviceRole).mockResolvedValue('employee');
    vi.mocked(readRememberedBusiness).mockResolvedValue(null);
    vi.mocked(readLaunchLink).mockResolvedValue(link('pos.example.com'));
    mount();

    expect(await screen.findByRole('heading', { name: 'personal screen' })).not.toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(connectEmployee).not.toHaveBeenCalled();
    expect(rememberBusiness).not.toHaveBeenCalled();
  });
});
