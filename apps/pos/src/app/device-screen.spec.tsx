import { render, screen } from '@testing-library/react';
import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DeviceSession } from '@/device/api/use-device-session';
import { LocaleProvider } from '@/shared/locale/locale-context';

import { DeviceScreen } from './device-screen';

const mockUseDeviceSession = vi.fn();
vi.mock('@/staff-login/ui/staff-login-screen', () => ({
  StaffLoginScreen: () => <h2>{t('ar', 'staffLogin.title')}</h2>,
}));

vi.mock('@/device/api/use-device-session', () => ({
  useDeviceSession: () => mockUseDeviceSession(),
}));

describe('DeviceScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the brand title, locale switch, and current screen body', () => {
    const session: DeviceSession = {
      screen: { kind: 'ready', branchId: '01923f66-3d2b-7c00-8000-000000000001' },
      retry: () => Promise.resolve(),
      submit: () => Promise.resolve(null),
      startOver: () => Promise.resolve(),
    };
    mockUseDeviceSession.mockReturnValue(session);

    render(
      <DirectionProvider dir="rtl">
        <LocaleProvider locale="ar" setLocale={() => undefined}>
          <DeviceScreen />
        </LocaleProvider>
      </DirectionProvider>,
    );

    expect(screen.getByText(t('ar', 'pos.appName'))).not.toBeNull();
    expect(screen.getByRole('button', { name: t('ar', 'pos.languageEnglish') })).not.toBeNull();
    expect(screen.getByRole('heading', { name: t('ar', 'staffLogin.title') })).not.toBeNull();
  });
});
