import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { t } from '@pospay/i18n';
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

it('MY-13b leaves the screen and wipes the state when the session ended', async () => {
  const onLeave = vi.fn();
  serve({ attendance: () => json({ code: 'UNAUTHENTICATED' }, 401) });
  renderWithProviders(
    <AttendanceScreen context={context} onLeave={onLeave} timeZone="Asia/Kuwait" />,
    'en',
  );
  await signIn();
  await waitFor(() => expect(onLeave).toHaveBeenCalledTimes(1));
  expect(screen.queryByText('Kuwait branch')).toBeNull();
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
});

it('MY-13b opens the window with the remaining time the server sent', async () => {
  const server = serve({
    open: () => json(opened('window-xyz', 45_000, 120_000)),
    attendance: () => json(month([session()])),
  });
  mount();
  await signIn();
  await screen.findByText('Kuwait branch');
  expect(server.paths('/private-view').length).toBe(1);
});
