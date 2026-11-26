import { screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { t } from '@pospay/i18n';
import { AttendanceScreen } from './attendance-screen';
import { json, month, renderWithProviders, serve, session } from './attendance-test-kit';

const context = { mode: 'personal' as const, identity: 'personal-corrected' };

/** MY-Q7: الرد نفسه مفيهوش وقت قديم ولا سبب ولا اسم مين عدّل، فالشاشة بتعرض الوقت الجديد و«اتعدّل» بس. */
const corrected = session({
  corrected: true,
  clock_in: '2026-11-03T09:00:00.000Z',
  clock_out: '2026-11-03T14:00:00.000Z',
});

it('MY-15 shows the corrected time and the corrected mark only', async () => {
  serve({ attendance: () => json(month([corrected])) });
  renderWithProviders(
    <AttendanceScreen context={context} onLeave={() => undefined} timeZone={undefined} />,
    'en',
  );
  expect(await screen.findByText('Clock-in: 12:00')).toBeTruthy();
  expect(screen.getByText('Clock-out: 17:00')).toBeTruthy();
  expect(screen.getByText(t('en', 'myAttendance.corrected'))).toBeTruthy();
});

it('MY-15 never shows a time before the correction, a reason or an editor', async () => {
  serve({ attendance: () => json(month([corrected])) });
  renderWithProviders(
    <AttendanceScreen context={context} onLeave={() => undefined} timeZone={undefined} />,
    'en',
  );
  await screen.findByText('Clock-in: 12:00');
  expect(screen.queryByText('Clock-in: 08:00')).toBeNull();
  expect(screen.queryByText(/reason/i)).toBeNull();
  expect(screen.queryByText(/manager|editor/i)).toBeNull();
});

it('MY-15 marks an uncorrected session with nothing', async () => {
  serve({ attendance: () => json(month([session()])) });
  renderWithProviders(
    <AttendanceScreen context={context} onLeave={() => undefined} timeZone={undefined} />,
    'ar',
  );
  await screen.findByText('Kuwait branch AR');
  expect(screen.queryByText(t('ar', 'myAttendance.corrected'))).toBeNull();
});
