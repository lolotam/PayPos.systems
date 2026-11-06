import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PersonalScreen } from '@/personal-staff/ui/personal-screen';
import { StaffLoginScreen } from '@/staff-login/ui/staff-login-screen';
import { LocaleProvider } from '@/shared/locale/locale-context';
import { OwnLeaveEntry } from './own-leave-entry';
import { personalLeave } from './personal-leave';

vi.mock('@/shared/api/device-auth', () => ({ currentDeviceToken: async () => 'synthetic-device' }));
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-04T10:00:00Z'));
});
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
  vi.useRealTimers();
  cleanup();
  vi.unstubAllGlobals();
  onlineManager.setOnline(true);
});

it.each([
  ['personal', '503'],
  ['personal', 'network'],
  ['reception', '503'],
  ['reception', 'network'],
] as const)(
  'preserves %s leave drafts through a %s probe but clears on401',
  async (mode, failure) => {
    onlineManager.setOnline(true);
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    let probe: 'ok' | '503' | 'network' | '401' = 'ok';
    vi.stubGlobal('fetch', transport);
    transport.mockImplementation(async (request: Request) => {
      const path = new URL(request.url).pathname;
      if (path.endsWith('/personal-session') || path.endsWith('/staff-session')) {
        if (probe === 'network') throw new TypeError('Synthetic network failure');
        return probe === 'ok'
          ? Response.json(session)
          : Response.json(
              { code: probe === '401' ? 'UNAUTHENTICATED' : 'NOT_READY' },
              { status: Number(probe) },
            );
      }
      if (path.endsWith('/branches'))
        return Response.json({
          items: [{ id: branch, name_ar: 'Branch', name_en: 'Branch', timezone: 'Asia/Kuwait' }],
        });
      if (path.endsWith('/passkey')) return Response.json({ bound: false });
      return Response.json({ items: [], request_branch_ids: [branch], next_cursor: null });
    });
    const cache = new QueryClient();
    mountSession(cache, mode);
    fireEvent.click(await screen.findByRole('button', { name: 'My leave' }));
    if (mode === 'personal') {
      await screen.findByRole('option', { name: 'Branch' });
      fireEvent.change(screen.getByLabelText('Branch'), { target: { value: branch } });
    }
    fireEvent.change(await screen.findByLabelText('From date'), {
      target: { value: '2026-12-01' },
    });
    probe = failure;
    const key = mode === 'personal' ? 'personal-session' : 'staff-session';
    await act(async () => {
      await cache.refetchQueries({ queryKey: [key] });
    });
    expect((screen.getByLabelText('From date') as HTMLInputElement).value).toBe('2026-12-01');
    probe = 'ok';
    await act(async () => {
      await cache.refetchQueries({ queryKey: [key] });
    });
    expect((screen.getByLabelText('From date') as HTMLInputElement).value).toBe('2026-12-01');
    probe = '401';
    await act(async () => {
      await cache.refetchQueries({ queryKey: [key] });
    });
    await waitFor(() => expect(screen.queryByLabelText('From date')).toBeNull());
    expect(cache.getQueriesData({ queryKey: ['my-leave'] })).toHaveLength(0);
  },
);

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
