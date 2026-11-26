import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { t, type Locale } from '@pospay/i18n';
import { LocaleProvider } from '@/shared/locale/locale-context';
import type * as NativeShellModule from '@/shared/platform/native-shell';
import { useClockAttendance } from '../api/use-clock-attendance';
import { ClockAttendanceScreen } from './clock-attendance-screen';

const capabilities = vi.hoisted(() => ({
  value: { webPush: true, passkeys: true, qrScan: true, attendanceCamera: true },
}));

vi.mock('@/shared/platform/native-shell', async (importOriginal) => ({
  ...(await importOriginal<typeof NativeShellModule>()),
  capabilities: vi.fn(() => capabilities.value),
}));
vi.mock('../api/use-clock-attendance', () => ({ useClockAttendance: vi.fn() }));
const start = vi.fn();
function mount(locale: Locale) {
  return render(
    <LocaleProvider locale={locale} setLocale={() => undefined}>
      <ClockAttendanceScreen />
    </LocaleProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  capabilities.value = { webPush: true, passkeys: true, qrScan: true, attendanceCamera: true };
  vi.mocked(useClockAttendance).mockReturnValue({
    scanning: false,
    pending: false,
    error: false,
    errorCode: null,
    result: null,
    scanned: async () => undefined,
    failed: () => undefined,
    stop: () => undefined,
    start,
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
});
it.each(['ar', 'en'] as const)(
  'shows an accepted result and exceptions plainly in %s',
  (locale) => {
    vi.mocked(useClockAttendance).mockReturnValue({
      ...useClockAttendance(),
      result: {
        operation: 'CLOCK_IN',
        session_id: 'synthetic',
        accepted_at: '2026-10-04T00:00:00Z',
        working_date: '2026-10-04',
        exceptions: ['NONE', 'OUT_OF_RANGE'],
        late_minutes: 11,
        missed_session_id: 'synthetic',
      },
    });
    const view = mount(locale);
    for (const key of ['clockedIn', 'noLocation', 'outOfRange', 'missedOut'] as const)
      expect(screen.getByText(t(locale, `personalAttendance.${key}`))).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: t(locale, 'personalAttendance.scan') }));
    expect(start).toHaveBeenCalledTimes(1);
    view.unmount();
  },
);
it('shows the scan button when the build has the attendance camera (MOB-T07)', () => {
  const view = mount('ar');

  expect(screen.getByRole('button', { name: t('ar', 'personalAttendance.scan') })).toBeDefined();
  expect(screen.queryByText(t('ar', 'nativeShell.webOnlyNotice'))).toBeNull();
  view.unmount();
});

it('shows the heading and the web app notice but no scan button without the camera (MOB-T05)', () => {
  capabilities.value = { webPush: true, passkeys: true, qrScan: true, attendanceCamera: false };
  vi.stubEnv('VITE_NATIVE', '1');
  vi.stubEnv('VITE_POS_HOST', 'pos.staging.pospay.systems');

  const view = mount('ar');

  expect(screen.getByRole('heading', { name: t('ar', 'personalAttendance.title') })).toBeDefined();
  expect(screen.queryByRole('button', { name: t('ar', 'personalAttendance.scan') })).toBeNull();
  expect(screen.getByText(t('ar', 'nativeShell.webOnlyNotice'))).toBeDefined();
  const link = screen.getByRole('link', { name: t('ar', 'nativeShell.openWebApp') });
  expect(link.getAttribute('href')).toBe('https://pos.staging.pospay.systems/personal');
  expect(start).not.toHaveBeenCalled();
  view.unmount();
});

it('pending blocks duplicate camera starts; cancellation is a translated retryable failure', () => {
  vi.mocked(useClockAttendance).mockReturnValue({
    ...useClockAttendance(),
    pending: true,
    error: true,
  });
  const view = mount('ar');
  expect(screen.getByRole('button').hasAttribute('disabled')).toBe(true);
  expect(screen.getByRole('alert').textContent).toBe(t('ar', 'personalAttendance.failed'));
  view.unmount();
});

it.each(['ar', 'en'] as const)(
  'phone refusals show recovery messages and keep the scan retryable in %s',
  (locale) => {
    const state = useClockAttendance();
    for (const [code, key] of [
      ['ATTENDANCE_DEVICE_LOCKED', 'errors.ATTENDANCE_DEVICE_LOCKED'],
      ['ATTENDANCE_DEVICE_NOT_ENROLLED', 'errors.ATTENDANCE_DEVICE_NOT_ENROLLED'],
      ['INSTALLATION_STORAGE_BLOCKED', 'personalAttendance.storageBlocked'],
    ] as const) {
      vi.mocked(useClockAttendance).mockReturnValue({
        ...state,
        error: true,
        errorCode: code,
      });
      const view = mount(locale);
      expect(screen.getByRole('alert').textContent).toBe(t(locale, key));
      expect(screen.getByRole('button').hasAttribute('disabled')).toBe(false);
      view.unmount();
    }
  },
);
