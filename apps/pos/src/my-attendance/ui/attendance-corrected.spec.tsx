import { screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { t } from '@pospay/i18n';
import { AttendanceScreen } from './attendance-screen';
import {
  type AttendanceSessionFixture,
  json,
  month,
  renderWithProviders,
  serve,
  session,
} from './attendance-test-kit';

const context = { mode: 'personal' as const, identity: 'personal-corrected' };

/** MY-Q7: الرد نفسه مفيهوش وقت قديم ولا سبب ولا اسم مين عدّل، فالشاشة بتعرض الوقت الجديد و«اتعدّل» بس. */
const corrected = session({
  corrected: true,
  clock_in: '2026-11-03T09:00:00.000Z',
  clock_out: '2026-11-03T14:00:00.000Z',
});

/** رد خام فيه حقول ممنوعة: الواجهة لازم ما تعرضهاش حتى لو وصلت من الشبكة بالغلط. */
const rawWithForbiddenFields = (fixture: AttendanceSessionFixture) => ({
  ...month([fixture]),
  sessions: [
    {
      ...fixture,
      reason: 'Late bus',
      edited_by: 'Sara Manager',
      original_clock_in: '2026-03-03T05:00:00.000Z',
    },
  ],
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
  serve({ attendance: () => json(rawWithForbiddenFields(corrected)) });
  renderWithProviders(
    <AttendanceScreen context={context} onLeave={() => undefined} timeZone={undefined} />,
    'en',
  );
  await screen.findByText('Clock-in: 12:00');
  expect(screen.getByText('Clock-out: 17:00')).toBeTruthy();
  expect(screen.getByText(t('en', 'myAttendance.corrected'))).toBeTruthy();
  expect(screen.queryByText('Clock-in: 08:00')).toBeNull();
  expect(screen.queryByText(/Late bus/)).toBeNull();
  expect(screen.queryByText(/Sara Manager/)).toBeNull();
  expect(screen.queryByText(/08:00/)).toBeNull();
  expect(screen.queryByText(/reason|manager|editor/i)).toBeNull();
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
