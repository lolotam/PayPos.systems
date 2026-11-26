import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { t } from '@pospay/i18n';
import { ReceptionAttendanceEntry } from '@/personal-staff/ui/reception-attendance-entry';
import { AttendanceScreen } from './attendance-screen';
import {
  isConcealed,
  json,
  month,
  opened,
  renderWithProviders,
  serve,
  session,
} from './attendance-test-kit';

vi.mock('@/shared/api/device-auth', () => ({ currentDeviceToken: async () => 'paired-device' }));

const context = { mode: 'reception' as const, identity: 'reception-1' };
const label = (key: Parameters<typeof t>[1]) => t('en', key);

const mount = () =>
  renderWithProviders(
    <AttendanceScreen context={context} onLeave={() => undefined} timeZone="Asia/Kuwait" />,
    'en',
  );

const signIn = async () => {
  fireEvent.change(await screen.findByLabelText(label('myAttendance.pinLabel')), {
    target: { value: '4321' },
  });
  fireEvent.click(screen.getByText(label('myAttendance.pinSubmit')));
};

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('MY-13b asks for the PIN first and reads nothing before it', async () => {
  const server = serve({ attendance: () => json(month([session()])) });
  mount();
  expect(await screen.findByText(label('myAttendance.pinTitle'))).toBeTruthy();
  expect(server.paths('/staff/me/attendance').length).toBe(0);
  await signIn();
  expect(await screen.findByText('Kuwait branch')).toBeTruthy();
});

it('MY-13b sends the private-view window id with every attendance read', async () => {
  const server = serve({ attendance: () => json(month([session()])) });
  mount();
  await signIn();
  await screen.findByText('Kuwait branch');
  const read = server.paths('/staff/me/attendance')[0];
  expect(read?.headers.get('x-private-view-window-id')).toBe('window-abc');
});

it('MY-13b goes back to the PIN step and hides the sessions when the window expired', async () => {
  const server = serve({
    attendance: () => json({ code: 'PRIVATE_VIEW_EXPIRED' }, 403),
  });
  mount();
  await signIn();
  expect(await screen.findByText(label('myAttendance.pinTitle'))).toBeTruthy();
  expect(screen.queryByText('Kuwait branch')).toBeNull();
  expect(screen.getByText(t('en', 'errors.PRIVATE_VIEW_EXPIRED'))).toBeTruthy();
  expect(server.paths('/private-view/close').length).toBe(1);
});

it('MY-13b goes back to the PIN step after sixty idle seconds', async () => {
  serve({ attendance: () => json(month([session()])) });
  mount();
  await signIn();
  expect(await screen.findByText('Kuwait branch')).toBeTruthy();
  await advance(61_000);
  expect(await screen.findByText(label('myAttendance.pinTitle'))).toBeTruthy();
  expect(screen.queryByText('Kuwait branch')).toBeNull();
});

/** يحاكي الشاشة الأم: onLeave بتقفل اللوحة كلها، فنشوف إن الصفوف اختفت واللوحة اتقفلت فعلاً. */
function Panel({ onLeave }: { onLeave: () => void }) {
  const [open, setOpen] = useState(true);
  if (!open) return <p>panel closed</p>;
  return (
    <AttendanceScreen
      context={context}
      timeZone="Asia/Kuwait"
      onLeave={() => {
        onLeave();
        setOpen(false);
      }}
    />
  );
}

it('MY-13b leaves the screen and wipes the sessions when the session ended mid-view', async () => {
  const onLeave = vi.fn();
  let reads = 0;
  serve({
    attendance: () => {
      reads += 1;
      return reads === 1 ? json(month([session()])) : json({ code: 'UNAUTHENTICATED' }, 401);
    },
  });
  renderWithProviders(<Panel onLeave={onLeave} />, 'en');
  await signIn();
  expect(await screen.findByText('Kuwait branch')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: label('myAttendance.previousMonth') }));
  expect(await screen.findByText('panel closed')).toBeTruthy();
  expect(onLeave).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Kuwait branch')).toBeNull();
  expect(screen.queryByLabelText(label('myAttendance.title'))).toBeNull();
});

it('MY-13b keeps nothing in the query cache in reception mode', async () => {
  serve({ attendance: () => json(month([session()])) });
  const view = mount();
  await signIn();
  await screen.findByText('Kuwait branch');
  expect(view.client.getQueryCache().findAll({ queryKey: ['my-attendance'] }).length).toBe(0);
});

it('FR-A09 reads nothing on the shared device while it is offline', async () => {
  const server = serve({ attendance: () => json(month([session()])) });
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  mount();
  expect(screen.getByText(label('myAttendance.offline'))).toBeTruthy();
  expect(server.paths('/staff/me/attendance').length).toBe(0);
});

it('MY-13b conceals the sessions inside the timer callback that closes the window', async () => {
  serve({ attendance: () => json(month([session()])) });
  mount();
  await signIn();
  const rows = await screen.findByText('Kuwait branch');
  expect(isConcealed(rows)).toBe(false);
  const flag = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  flag.IS_REACT_ACT_ENVIRONMENT = false;
  try {
    vi.advanceTimersByTime(61_000);
    expect(isConcealed(rows)).toBe(true);
  } finally {
    flag.IS_REACT_ACT_ENVIRONMENT = true;
  }
  await advance(50);
  expect(screen.queryByText('Kuwait branch')).toBeNull();
  expect(screen.getByLabelText(label('myAttendance.pinLabel'))).toBeTruthy();
});

it('MY-13b opens the window with the PIN and closes it again on the way out', async () => {
  const server = serve({ attendance: () => json(month([session()])) });
  mount();
  await signIn();
  await screen.findByText('Kuwait branch');
  expect(server.paths('/private-view').length).toBe(1);
  window.dispatchEvent(new Event('blur'));
  expect(await screen.findByText(label('myAttendance.pinTitle'))).toBeTruthy();
  expect(screen.queryByText('Kuwait branch')).toBeNull();
  await waitFor(() => expect(server.paths('/private-view/close').length).toBe(1));
  const closed = server.paths('/private-view/close')[0];
  expect(closed?.method).toBe('POST');
});

it('MY-13b closes the window when the remaining time the server sent runs out', async () => {
  serve({
    open: () => json(opened('window-xyz', 45_000, 120_000)),
    attendance: () => json(month([session()])),
  });
  mount();
  await signIn();
  expect(await screen.findByText('Kuwait branch')).toBeTruthy();
  await advance(44_000);
  expect(screen.getByText('Kuwait branch')).toBeTruthy();
  await advance(2_000);
  expect(await screen.findByText(label('myAttendance.pinTitle'))).toBeTruthy();
  expect(screen.queryByText('Kuwait branch')).toBeNull();
});

it('D-A14 steps to the previous month inside the window with the same window id', async () => {
  const monthOf = (request: Request) => new URL(request.url).searchParams.get('month');
  const server = serve({
    attendance: (request) =>
      monthOf(request) === '2026-10'
        ? json(month([session({ branch_name_en: 'October branch', branch_name_ar: null })], '2026-10'))
        : json(month([session()], '2026-11')),
  });
  mount();
  await signIn();
  await screen.findByText('Kuwait branch');
  fireEvent.click(screen.getByRole('button', { name: label('myAttendance.previousMonth') }));
  expect(await screen.findByText('October branch')).toBeTruthy();
  expect(screen.queryByText('Kuwait branch')).toBeNull();
  const reads = server.paths('/staff/me/attendance');
  expect(reads.map(monthOf)).toEqual([null, '2026-10']);
  expect(reads[1]?.headers.get('x-private-view-window-id')).toBe('window-abc');
});

it('MY-13 says the older months are not available inside the window and stops going back', async () => {
  const server = serve({
    attendance: (request) =>
      new URL(request.url).searchParams.get('month') === '2026-10'
        ? json({ code: 'MY_PERIOD_OUT_OF_RANGE' }, 422)
        : json(month([session()], '2026-11')),
  });
  mount();
  await signIn();
  await screen.findByText('Kuwait branch');
  fireEvent.click(screen.getByRole('button', { name: label('myAttendance.previousMonth') }));
  expect(await screen.findByText(label('myAttendance.outOfRange'))).toBeTruthy();
  expect(
    screen
      .getByRole('button', { name: label('myAttendance.previousMonth') })
      .hasAttribute('disabled'),
  ).toBe(true);
  expect(screen.queryByText(label('myAttendance.pinTitle'))).toBeNull();
  expect(server.paths('/staff/me/attendance').length).toBe(2);
});

it('MY-13b goes back to the closed step with the old sessions gone when the operator changes', async () => {
  serve({ attendance: () => json(month([session()])) });
  const operator = (userId: string) => ({
    user_id: userId,
    company_id: '00000000-0000-4000-8000-000000000002',
    business_id: '00000000-0000-4000-8000-000000000003',
    branch_id: '00000000-0000-4000-8000-000000000005',
    device_id: '00000000-0000-4000-8000-000000000006',
    expires_at: '2026-12-01T10:00:00.000Z',
  });
  const entry = (userId: string) => (
    <ReceptionAttendanceEntry
      session={operator(userId)}
      epoch={0}
      timeZone="Asia/Kuwait"
    />
  );
  const view = renderWithProviders(entry('00000000-0000-4000-8000-000000000001'), 'en');
  fireEvent.click(screen.getByRole('button', { name: label('myAttendance.title') }));
  await signIn();
  expect(await screen.findByText('Kuwait branch')).toBeTruthy();
  view.rerenderWithProviders(entry('00000000-0000-4000-8000-000000000009'));
  expect(screen.queryByText('Kuwait branch')).toBeNull();
  expect(screen.queryByLabelText(label('myAttendance.pinLabel'))).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: label('myAttendance.title') }));
  expect(await screen.findByLabelText(label('myAttendance.pinLabel'))).toBeTruthy();
  expect(screen.queryByText('Kuwait branch')).toBeNull();
});
