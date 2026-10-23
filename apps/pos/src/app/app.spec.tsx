import { render, screen } from '@testing-library/react';
import { t } from '@pospay/i18n';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isNativeShell } from '@/shared/platform/native-shell';

import { App } from './app';

vi.mock('@/shared/platform/native-shell', () => ({
  isNativeShell: vi.fn(),
}));
vi.mock('@/app/device-screen', () => ({
  DeviceScreen: () => <h2>device screen</h2>,
}));
vi.mock('@/personal-staff/ui/personal-screen', () => ({
  PersonalScreen: () => <h2>personal screen</h2>,
}));
vi.mock('@/app/device-role', () => ({
  readDeviceRole: vi.fn(() => Promise.resolve(null)),
  saveDeviceRole: vi.fn(() => Promise.resolve()),
}));

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isNativeShell).mockReturnValue(false);
    window.localStorage.setItem('pospay.locale', 'ar');
    window.history.pushState({}, '', '/');
  });

  it('keeps the web build on the device screen at the root path', async () => {
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'device screen' })).not.toBeNull();
    expect(screen.queryByRole('heading', { name: t('ar', 'nativeShell.title') })).toBeNull();
  });

  it('keeps the web build on the personal screen at the personal path', async () => {
    window.history.pushState({}, '', '/personal');
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'personal screen' })).not.toBeNull();
    expect(screen.queryByRole('heading', { name: 'device screen' })).toBeNull();
  });

  it('opens the native entry flow on the native build', async () => {
    vi.mocked(isNativeShell).mockReturnValue(true);
    render(<App />);

    expect(await screen.findByRole('heading', { name: t('ar', 'nativeShell.title') })).not.toBeNull();
    expect(screen.queryByRole('heading', { name: 'device screen' })).toBeNull();
  });
});
