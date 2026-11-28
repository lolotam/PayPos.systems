import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DeviceSession } from '@/device/api/use-device-session';
import { LocaleProvider } from '@/shared/locale/locale-context';

import { DeviceScreen } from './device-screen';

const mockUseDeviceSession = vi.fn();
vi.mock('@/staff-login/api/use-staff-login', () => ({
  useStaffLogin: () => ({ online: true, authenticatedSession: null }),
}));
vi.mock('@/staff-login/ui/staff-login-panel', () => ({
  StaffLoginPanel: () => <h2>{t('ar', 'staffLogin.title')}</h2>,
}));

vi.mock('@/attendance/api/use-attendance-qr', () => ({
  useAttendanceQr: () => ({
    branch: undefined,
    now: null,
    payload: null,
    notice: 'loading',
    retry: () => undefined,
  }),
}));

vi.mock('@/device/api/use-device-session', () => ({
  useDeviceSession: () => mockUseDeviceSession(),
}));

/** شاشة جهاز مقترن جاهز، وبيترك تنبيه اختياري جوه الإطار. */
function mountScreen(notice?: ReactNode) {
  mockUseDeviceSession.mockReturnValue({
    screen: { kind: 'ready', branchId: '01923f66-3d2b-7c00-8000-000000000001' },
    submitting: false,
    retry: () => Promise.resolve(),
    submit: () => Promise.resolve(null),
    startOver: () => Promise.resolve(),
  } satisfies DeviceSession);
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <DirectionProvider dir="rtl">
        <LocaleProvider locale="ar" setLocale={() => undefined}>
          <DeviceScreen {...(notice === undefined ? {} : { notice })} />
        </LocaleProvider>
      </DirectionProvider>
    </QueryClientProvider>,
  );
}

describe('DeviceScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the brand title, locale switch, and current screen body', () => {
    const { container } = mountScreen();

    expect(screen.getByText(t('ar', 'pos.appName'))).not.toBeNull();
    expect(screen.getByRole('button', { name: t('ar', 'pos.languageEnglish') })).not.toBeNull();
    expect(screen.getByRole('heading', { name: t('ar', 'staffLogin.title') })).not.toBeNull();
    expect(container.querySelector('header')).not.toBeNull();
  });

  it('shows the alert inside the frame, under the header', () => {
    mountScreen(<p role="alert">test alert</p>);

    const alert = screen.getByRole('alert');
    const main = screen.getByRole('main');
    const header = document.querySelector('header');

    expect(main.contains(alert)).toBe(true);
    expect(header).not.toBeNull();
    expect(
      (header?.compareDocumentPosition(main) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
