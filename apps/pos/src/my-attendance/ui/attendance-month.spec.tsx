import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { t } from '@pospay/i18n';
import { AttendanceScreen } from './attendance-screen';
import { json, month, renderWithProviders, serve, session } from './attendance-test-kit';

const context = { mode: 'personal' as const, identity: 'personal-months' };

const mount = () =>
  renderWithProviders(
    <AttendanceScreen context={context} onLeave={() => undefined} timeZone={undefined} />,
    'en',
  );

const monthOf = (request: Request) => new URL(request.url).searchParams.get('month');

it('D-A14 asks for the previous month and comes back to the current one', async () => {
  const server = serve({
    attendance: (request) => {
      const asked = monthOf(request);
      return json(month([session()], asked ?? '2026-11'));
    },
  });
  mount();
  await screen.findByText('Kuwait branch');
  fireEvent.click(screen.getByRole('button', { name: t('en', 'myAttendance.previousMonth') }));
  await waitFor(() =>
    expect(server.paths('/staff/me/attendance').map(monthOf)).toContain('2026-10'),
  );
  fireEvent.click(screen.getByRole('button', { name: t('en', 'myAttendance.nextMonth') }));
  await waitFor(() =>
    expect(server.paths('/staff/me/attendance').map(monthOf)).toContain(null),
  );
});

it('D-A14 closes the next month at the current one the server named', async () => {
  serve({ attendance: () => json(month([session()], '2026-11')) });
  mount();
  await screen.findByText('Kuwait branch');
  expect(
    screen.getByRole('button', { name: t('en', 'myAttendance.nextMonth') }).hasAttribute('disabled'),
  ).toBe(true);
});

it('MY-13 says the older months are not available and stops going back after 422', async () => {
  const server = serve({
    attendance: (request) =>
      monthOf(request) === '2026-10'
        ? json({ code: 'MY_PERIOD_OUT_OF_RANGE' }, 422)
        : json(month([session()], '2026-11')),
  });
  mount();
  await screen.findByText('Kuwait branch');
  fireEvent.click(screen.getByRole('button', { name: t('en', 'myAttendance.previousMonth') }));
  expect(await screen.findByText(t('en', 'myAttendance.outOfRange'))).toBeTruthy();
  expect(
    screen.getByRole('button', { name: t('en', 'myAttendance.previousMonth') }).hasAttribute('disabled'),
  ).toBe(true);
  expect(server.paths('/staff/me/attendance').length).toBe(2);
});

it('a refused page is shown as refused, with no retry', async () => {
  serve({ attendance: () => json({ code: 'FORBIDDEN' }, 403) });
  mount();
  expect(await screen.findByText(t('en', 'myAttendance.refused'))).toBeTruthy();
  expect(screen.queryByRole('button', { name: t('en', 'myAttendance.retry') })).toBeNull();
});
