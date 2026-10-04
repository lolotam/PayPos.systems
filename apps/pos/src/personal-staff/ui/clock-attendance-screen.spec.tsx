import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { t, type Locale } from '@pospay/i18n';
import { LocaleProvider } from '@/shared/locale/locale-context';
import { useClockAttendance } from '../api/use-clock-attendance';
import { ClockAttendanceScreen } from './clock-attendance-screen';
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
  vi.mocked(useClockAttendance).mockReturnValue({
    scanning: false,
    pending: false,
    error: false,
    result: null,
    scanned: async () => undefined,
    failed: () => undefined,
    stop: () => undefined,
    start,
  });
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
