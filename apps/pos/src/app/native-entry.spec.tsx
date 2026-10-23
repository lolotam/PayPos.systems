import { fireEvent, render, screen } from '@testing-library/react';
import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readDeviceRole, saveDeviceRole, type DeviceRole } from '@/app/device-role';
import { LocaleProvider } from '@/shared/locale/locale-context';

import { NativeEntry } from './native-entry';

vi.mock('@/app/device-role', () => ({
  readDeviceRole: vi.fn(),
  saveDeviceRole: vi.fn(),
}));
vi.mock('@/app/device-screen', () => ({
  DeviceScreen: () => <h2>device screen</h2>,
}));
vi.mock('@/personal-staff/ui/personal-screen', () => ({
  PersonalScreen: () => <h2>personal screen</h2>,
}));

const storedRoles: [DeviceRole, string][] = [
  ['counter', 'device screen'],
  ['employee', 'personal screen'],
];

function mount() {
  render(
    <DirectionProvider dir="rtl">
      <LocaleProvider locale="ar" setLocale={() => undefined}>
        <NativeEntry />
      </LocaleProvider>
    </DirectionProvider>,
  );
}

describe('NativeEntry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readDeviceRole).mockResolvedValue(null);
    vi.mocked(saveDeviceRole).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the start screen when no role is stored yet', async () => {
    mount();

    expect(
      await screen.findByRole('heading', { name: t('ar', 'nativeShell.title') }),
    ).not.toBeNull();
    expect(screen.queryByRole('heading', { name: 'device screen' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'personal screen' })).toBeNull();
  });

  it.each(storedRoles)('opens the %s flow directly when the role is stored', async (role, heading) => {
    vi.mocked(readDeviceRole).mockResolvedValue(role);
    mount();

    expect(await screen.findByRole('heading', { name: heading })).not.toBeNull();
    expect(screen.queryByRole('heading', { name: t('ar', 'nativeShell.title') })).toBeNull();
  });

  it('saves the employee choice and opens the employee flow', async () => {
    mount();

    fireEvent.click(await screen.findByRole('button', { name: t('ar', 'nativeShell.employee') }));

    expect(await screen.findByRole('heading', { name: 'personal screen' })).not.toBeNull();
    expect(saveDeviceRole).toHaveBeenCalledWith('employee');
  });

  it('saves the counter choice and opens the counter flow', async () => {
    mount();

    fireEvent.click(await screen.findByRole('button', { name: t('ar', 'nativeShell.counter') }));

    expect(await screen.findByRole('heading', { name: 'device screen' })).not.toBeNull();
    expect(saveDeviceRole).toHaveBeenCalledWith('counter');
  });

  it('keeps the start screen and warns when the choice cannot be saved', async () => {
    vi.mocked(saveDeviceRole).mockRejectedValue(new Error('SYNTHETIC_SAVE_FAILURE'));
    mount();

    fireEvent.click(await screen.findByRole('button', { name: t('ar', 'nativeShell.counter') }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(t('ar', 'nativeShell.saveFailed'));
    expect(screen.getByRole('heading', { name: t('ar', 'nativeShell.title') })).not.toBeNull();
  });

  it('stores nothing and asks for the internet when the choice is made offline', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    mount();

    fireEvent.click(await screen.findByRole('button', { name: t('ar', 'nativeShell.employee') }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(t('ar', 'nativeShell.needsInternet'));
    expect(screen.getByRole('heading', { name: t('ar', 'nativeShell.title') })).not.toBeNull();
    expect(screen.queryByRole('heading', { name: 'device screen' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'personal screen' })).toBeNull();
    expect(saveDeviceRole).not.toHaveBeenCalled();
  });

  it('shows the loading notice while the stored role is being read', () => {
    vi.mocked(readDeviceRole).mockReturnValue(new Promise<DeviceRole | null>(() => undefined));
    mount();

    expect(screen.getByRole('status')).not.toBeNull();
    expect(screen.getByText(t('ar', 'pos.loading'))).not.toBeNull();
    expect(screen.queryByRole('heading', { name: t('ar', 'nativeShell.title') })).toBeNull();
  });
});
