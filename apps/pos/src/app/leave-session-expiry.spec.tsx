import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { PersonalScreen } from '@/personal-staff/ui/personal-screen';
import { StaffLoginScreen } from '@/staff-login/ui/staff-login-screen';
import { LocaleProvider } from '@/shared/locale/locale-context';
import { OwnLeaveEntry } from './own-leave-entry';
import { personalLeave } from './personal-leave';

vi.mock('@/shared/api/device-auth', () => ({ currentDeviceToken: async () => 'synthetic-device' }));
const transport = vi.fn<(request: Request) => Promise<Response>>();
const branch = '00000000-0000-4000-8000-000000000001';
const session = {
  company_id: 'company',
  business_id: 'business',
  user_id: 'employee',
  employee_id: 'employee',
  expires_at: '2026-12-01T20:00:00Z',
};
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  onlineManager.setOnline(true);
});

it.each([
  ['personal', 'timer', '503'],
  ['reception', 'timer', 'network'],
  ['personal', 'visibility', 'network'],
  ['reception', 'visibility', '503'],
  ['personal', 'focus', '503'],
  ['reception', 'focus', 'network'],
] as const)(
  'expires private %s data during failed %s probes via %s',
  async (mode, trigger, failure) => {
    vi.useFakeTimers({
      toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
    });
    vi.setSystemTime(new Date('2026-12-01T19:59:00Z'));
    onlineManager.setOnline(true);
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    const state = { failed: false };
    expiryTransport(state, failure);
    const cache = new QueryClient();
    mountSession(cache, mode);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    fireEvent.click(screen.getByRole('button', { name: 'My leave' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    if (mode === 'personal') {
      fireEvent.change(screen.getByLabelText('Branch'), { target: { value: branch } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });
    }
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-12-01' } });
    state.failed = true;
    await act(async () => {
      await cache.refetchQueries({
        queryKey: [mode === 'personal' ? 'personal-session' : 'staff-session'],
      });
      await vi.advanceTimersByTimeAsync(10);
    });
    expect((screen.getByLabelText('From date') as HTMLInputElement).value).toBe('2026-12-01');
    expect(cache.getQueriesData({ queryKey: ['my-leave'] }).length).toBeGreaterThan(0);
    await act(async () => {
      if (trigger === 'timer') await vi.advanceTimersByTimeAsync(60_000);
      else {
        vi.setSystemTime(new Date('2026-12-01T20:00:01Z'));
        if (trigger === 'focus') window.dispatchEvent(new Event('focus'));
        else document.dispatchEvent(new Event('visibilitychange'));
        await vi.advanceTimersByTimeAsync(10);
      }
    });
    expect(screen.queryByLabelText('From date')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Submit request' })).toBeNull();
    expect(cache.getQueriesData({ queryKey: ['my-leave'] })).toHaveLength(0);
  },
);
function expiryTransport(state: { failed: boolean }, failure: '503' | 'network') {
  vi.stubGlobal('fetch', transport);
  transport.mockImplementation(async (request: Request) => {
    const path = new URL(request.url).pathname;
    if (path.endsWith('/personal-session') || path.endsWith('/staff-session')) {
      if (!state.failed) return Response.json(session);
      if (failure === 'network') throw new TypeError('Synthetic network failure');
      return Response.json({ code: 'NOT_READY' }, { status: 503 });
    }
    if (path.endsWith('/branches'))
      return Response.json({
        items: [{ id: branch, name_ar: 'Branch', name_en: 'Branch', timezone: 'Asia/Kuwait' }],
      });
    if (path.endsWith('/passkey')) return Response.json({ bound: false });
    return Response.json({ items: [], request_branch_ids: [branch], next_cursor: null });
  });
}
function mountSession(cache: QueryClient, mode: 'personal' | 'reception') {
  render(
    <QueryClientProvider client={cache}>
      <LocaleProvider locale="en" setLocale={() => undefined}>
        {mode === 'personal' ? (
          <PersonalScreen ownLeave={personalLeave} />
        ) : (
          <StaffLoginScreen
            ownLeave={(current, epoch) => (
              <OwnLeaveEntry
                context={{
                  mode: 'reception',
                  ...current,
                  branch_id: branch,
                  timezone: 'Asia/Kuwait',
                  sessionEpoch: epoch,
                }}
              />
            )}
          />
        )}
      </LocaleProvider>
    </QueryClientProvider>,
  );
}
