import { screen, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { t } from '@pospay/i18n';
import { AttendanceScreen } from './attendance-screen';
import { json, month, renderWithProviders, serve, session } from './attendance-test-kit';

const context = { mode: 'personal' as const, identity: 'personal-1' };

function mount(locale: 'ar' | 'en' = 'en') {
  return renderWithProviders(
    <AttendanceScreen context={context} onLeave={() => undefined} timeZone={undefined} />,
    locale,
  );
}

it('MY-14 lists the month sessions by working date with the branch, the times and the source', async () => {
  serve({
    attendance: () =>
      json(
        month([
          session(),
          session({
            id: '00000000-0000-4000-8000-000000000002',
            working_date: '2026-11-04',
            source: 'BARCODE',
          }),
        ]),
      ),
  });
  mount('en');
  expect((await screen.findAllByText('Kuwait branch')).length).toBe(2);
  expect(screen.getByText('QR code')).toBeTruthy();
  expect(screen.getByText('Card')).toBeTruthy();
  expect(screen.getAllByText('Clock-in: 08:00').length).toBe(2);
  expect(screen.getAllByText('Clock-out: 16:00').length).toBe(2);
  expect(screen.getByText('November 3, 2026')).toBeTruthy();
  expect(screen.getByText('November 4, 2026')).toBeTruthy();
});

it('MY-14 shows an open session as still clocked in and a missed clock-out as missed', async () => {
  serve({
    attendance: () =>
      json(
        month([
          session({
            id: '00000000-0000-4000-8000-000000000003',
            status: 'OPEN',
            clock_out: null,
          }),
          session({
            id: '00000000-0000-4000-8000-000000000004',
            status: 'MISSED_OUT',
            clock_out: null,
          }),
        ]),
      ),
  });
  mount('en');
  expect(await screen.findByText(/Still clocked in/)).toBeTruthy();
  expect(screen.getByText(/Missed clock-out/)).toBeTruthy();
});

it('MY-14 shows the lateness, the manual source and the open exception kinds without notes', async () => {
  serve({
    attendance: () =>
      json(
        month([
          session({
            late_minutes: 12,
            source: 'MANUAL',
            open_exceptions: ['OUT_OF_RANGE', 'SUSPECTED_MISSED_OUT'],
          }),
        ]),
      ),
  });
  mount('en');
  expect(await screen.findByText('12 minutes late')).toBeTruthy();
  expect(screen.getByText('Manual')).toBeTruthy();
  expect(screen.getByText('Out of range · Suspected missing clock-out')).toBeTruthy();
});

it('MY-14 says the month has no sessions when the server returns none', async () => {
  serve({ attendance: () => json(month([])) });
  mount('en');
  expect(await screen.findByText(t('en', 'myAttendance.empty'))).toBeTruthy();
});

it('MY-14 shows the Arabic copy right to left', async () => {
  serve({ attendance: () => json(month([session()])) });
  mount('ar');
  expect(await screen.findByText('Kuwait branch AR')).toBeTruthy();
  expect(screen.getByText(`${t('ar', 'myAttendance.clockIn')}: 08:00`)).toBeTruthy();
  expect(screen.getByText(t('ar', 'myAttendance.sourceQr'))).toBeTruthy();
  const section = screen.getByLabelText(t('ar', 'myAttendance.title'));
  expect(section.getAttribute('dir')).toBe('rtl');
});

it('MY-14 falls back to the English branch name when the branch has no Arabic one', async () => {
  serve({ attendance: () => json(month([session({ branch_name_ar: null })])) });
  mount('ar');
  expect(await screen.findByText('Kuwait branch')).toBeTruthy();
});

it('FR-A09 blocks the read while the device is offline', async () => {
  const server = serve({ attendance: () => json(month([session()])) });
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  mount('en');
  expect(screen.getByText(t('en', 'myAttendance.offline'))).toBeTruthy();
  expect(server.paths('/staff/me/attendance').length).toBe(0);
});
it('a failed read shows the failure with a retry that reads again', async () => {
  let attempt = 0;
  serve({
    attendance: () => {
      attempt += 1;
      return attempt === 1
        ? json({ code: 'NOT_READY' }, 503)
        : json(month([session()]));
    },
  });
  mount('en');
  expect(await screen.findByText(t('en', 'myAttendance.failed'))).toBeTruthy();
  screen.getByRole('button', { name: t('en', 'myAttendance.retry') }).click();
  await waitFor(() => expect(screen.getByText('Kuwait branch')).toBeTruthy());
});
