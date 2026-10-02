import { render, screen } from '@testing-library/react';
import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { describe, expect, it, vi } from 'vitest';

import type { DeviceSession } from '@/device/api/use-device-session';
import { LocaleProvider } from '@/shared/locale/locale-context';

import { DeviceBody } from './device-body';
vi.mock('@/staff-login/ui/staff-login-screen', () => ({
  StaffLoginScreen: () => <h2>{t('ar', 'staffLogin.title')}</h2>,
}));

function renderBody(session: DeviceSession) {
  return render(
    <DirectionProvider dir="rtl">
      <LocaleProvider locale="ar" setLocale={() => undefined}>
        <DeviceBody session={session} />
      </LocaleProvider>
    </DirectionProvider>,
  );
}

function makeSession(partialScreen: DeviceSession['screen']): DeviceSession {
  return {
    screen: partialScreen,
    retry: () => Promise.resolve(),
    submit: () => Promise.resolve(null),
    startOver: () => Promise.resolve(),
  };
}

describe('DeviceBody', () => {
  it('renders loading notice when screen state is loading', () => {
    renderBody(makeSession({ kind: 'loading' }));
    expect(screen.getByText(t('ar', 'pos.loading'))).not.toBeNull();
  });

  it('renders pairing screen when screen state is pairing', () => {
    renderBody(makeSession({ kind: 'pairing', notice: null }));
    expect(screen.getByRole('heading', { name: t('ar', 'pos.pairingTitle') })).not.toBeNull();
  });

  it('renders waiting screen when screen state is waiting', () => {
    renderBody(makeSession({ kind: 'waiting' }));
    expect(screen.getByRole('heading', { name: t('ar', 'pos.waitingTitle') })).not.toBeNull();
  });

  it('renders offline notice when screen state is offline', () => {
    renderBody(makeSession({ kind: 'offline' }));
    expect(screen.getByRole('heading', { name: t('ar', 'pos.offlineTitle') })).not.toBeNull();
  });

  it('renders staff login when the paired device is ready', () => {
    const branchId = '01923f66-3d2b-7c00-8000-000000000001';
    renderBody(makeSession({ kind: 'ready', branchId }));

    expect(screen.getByRole('heading', { name: t('ar', 'staffLogin.title') })).not.toBeNull();
  });
});
