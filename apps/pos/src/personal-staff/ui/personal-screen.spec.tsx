import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { t } from '@pospay/i18n';
import { LocaleProvider } from '@/shared/locale/locale-context';
import { attendanceCalls, attendancePosition } from '../api/attendance-calls';
import { personalCalls } from '../api/personal-calls';
import { observePersonalChange } from '../model/session-change';
import { PersonalScreen } from './personal-screen';

vi.mock('../api/personal-calls', () => ({
  personalCalls: { session: vi.fn(), binding: vi.fn(), signOut: vi.fn() },
}));
vi.mock('../api/attendance-calls', () => ({
  attendanceCalls: { clock: vi.fn() },
  attendancePosition: vi.fn(),
}));
vi.mock('../model/session-change', () => ({
  observePersonalChange: vi.fn(() => () => undefined),
  announcePersonalChange: vi.fn(),
}));
vi.mock('./attendance-camera', () => ({
  AttendanceCamera: ({ scanned }: { scanned(value: string): Promise<void> }) => (
    <button
      onClick={() =>
        void scanned(
          JSON.stringify({
            branch_id: '00000000-0000-4000-8000-000000000001',
            window: 1,
            sig: 'a'.repeat(64),
          }),
        )
      }
    >
      synthetic camera
    </button>
  ),
}));
const session = {
  user_id: 'user',
  employee_id: 'employee',
  company_id: 'company',
  business_id: 'business',
  expires_at: '2026-10-05T12:00:00Z',
};
function mount() {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={cache}>
      <LocaleProvider locale="en" setLocale={() => undefined}>
        <PersonalScreen />
      </LocaleProvider>
    </QueryClientProvider>,
  );
  return { cache, ...view };
}
async function beginCeremony() {
  const f = mount();
  fireEvent.click(await screen.findByRole('button', { name: t('en', 'personalAttendance.scan') }));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'synthetic camera' }));
  });
  await waitFor(() => expect(attendanceCalls.clock).toHaveBeenCalledTimes(1));
  const signal = vi.mocked(attendanceCalls.clock).mock.calls[0]?.[1];
  if (signal === undefined) throw new Error('SYNTHETIC_SIGNAL_MISSING');
  return { ...f, signal };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  vi.mocked(personalCalls.session).mockResolvedValue(session);
  vi.mocked(personalCalls.binding).mockResolvedValue({
    bound: true,
    binding_id: 'binding',
    revision: 1,
    bound_at: '2026-10-04T00:00:00Z',
  });
  vi.mocked(personalCalls.signOut).mockResolvedValue(undefined);
  vi.mocked(attendancePosition).mockResolvedValue(undefined);
  vi.mocked(attendanceCalls.clock).mockImplementation(() => new Promise(() => undefined));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('a 15-second poll preserves the camera and the pending passkey request; invalidation aborts it', async () => {
  const f = mount();
  fireEvent.click(await screen.findByRole('button', { name: t('en', 'personalAttendance.scan') }));
  let finishPoll!: (value: typeof session | null) => void;
  vi.mocked(personalCalls.session).mockImplementation(
    () =>
      new Promise((resolve) => {
        finishPoll = resolve;
      }),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15000);
  });
  expect(personalCalls.session).toHaveBeenCalledTimes(2);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'synthetic camera' }));
  });
  expect(attendancePosition).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(attendanceCalls.clock).toHaveBeenCalledTimes(1));
  const signal = vi.mocked(attendanceCalls.clock).mock.calls[0]?.[1];
  expect(signal?.aborted).toBe(false);
  await act(async () => {
    finishPoll(session);
  });
  f.cache.setQueryData(['private-schedule'], { private: true });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15000);
  });
  expect(screen.getByText(t('en', 'personalAttendance.pending'))).toBeDefined();
  expect(signal?.aborted).toBe(false);
  await act(async () => {
    finishPoll(null);
  });
  await waitFor(() => expect(signal?.aborted).toBe(true));
  expect(screen.queryByText(t('en', 'personalAttendance.pending'))).toBeNull();
  await waitFor(() => expect(f.cache.getQueryData(['private-schedule'])).toBeUndefined());
  f.unmount();
});
it('a transient validation error keeps the confirmed session and ceremony', async () => {
  const f = await beginCeremony();
  vi.mocked(personalCalls.session).mockRejectedValue(new Error('SYNTHETIC_NETWORK_FAILURE'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15000);
  });
  await waitFor(() => expect(f.cache.getQueryState(['personal-session', 0])?.status).toBe('error'));
  expect(screen.getByText(t('en', 'personalAttendance.pending'))).toBeDefined();
  expect(f.signal.aborted).toBe(false);
  f.unmount();
});
it.each(['logout', 'replacement', 'offline'] as const)(
  '%s tears down the pending ceremony and private cache',
  async (reason) => {
    const f = await beginCeremony();
    f.cache.setQueryData(['private-schedule'], { private: true });
    vi.mocked(personalCalls.session).mockResolvedValue(null);
    await act(async () => {
      if (reason === 'logout')
        fireEvent.click(screen.getByRole('button', { name: t('en', 'personalStaff.signOut') }));
      else if (reason === 'replacement') vi.mocked(observePersonalChange).mock.calls[0]?.[0]();
      else {
        vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
        window.dispatchEvent(new Event('offline'));
      }
    });
    await waitFor(() => expect(f.signal.aborted).toBe(true));
    expect(f.cache.getQueryData(['private-schedule'])).toBeUndefined();
    f.unmount();
  },
);
