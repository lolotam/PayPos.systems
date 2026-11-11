import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StaffLoginScreen } from '@/staff-login/ui/staff-login-screen';
import { LocaleProvider } from '@/shared/locale/locale-context';
import { OwnLeaveEntry } from './own-leave-entry';

vi.mock('@/shared/api/device-auth', () => ({ currentDeviceToken: async () => 'synthetic-device' }));
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-04T10:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.unstubAllGlobals();
});

it('keeps the reception form during a background probe and clears it on refused revalidation', async () => {
  const session = {
    company_id: 'company',
    business_id: 'business',
    user_id: 'employee',
    expires_at: '2026-12-01T20:00:00Z',
  };
  let probe: (() => Promise<Response>) | undefined;
  vi.stubGlobal('fetch', async (request: Request) =>
    new URL(request.url).pathname.endsWith('/staff-session')
      ? (probe?.() ?? Response.json(session))
      : Response.json({ items: [], request_branch_ids: ['branch'], next_cursor: null }),
  );
  const cache = new QueryClient();
  render(
    <QueryClientProvider client={cache}>
      <LocaleProvider locale="en" setLocale={() => undefined}>
        <StaffLoginScreen
          ownLeave={(current, epoch) => (
            <OwnLeaveEntry
              context={{
                mode: 'reception',
                ...current,
                branch_id: 'branch',
                timezone: 'Asia/Kuwait',
                sessionEpoch: epoch,
              }}
            />
          )}
        />
      </LocaleProvider>
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'My leave' }));
  fireEvent.change(await screen.findByLabelText('From date'), { target: { value: '2026-12-01' } });
  let finish: (response: Response) => void = () => undefined;
  probe = () =>
    new Promise<Response>((resolve) => {
      finish = resolve;
    });
  let refresh: Promise<void>;
  act(() => {
    refresh = cache.refetchQueries({ queryKey: ['staff-session'] });
  });
  await waitFor(() => expect(cache.isFetching({ queryKey: ['staff-session'] })).toBe(1));
  expect((screen.getByLabelText('From date') as HTMLInputElement).value).toBe('2026-12-01');
  await act(async () => {
    finish(Response.json(session));
    await refresh;
  });
  expect((screen.getByLabelText('From date') as HTMLInputElement).value).toBe('2026-12-01');
  probe = async () => Response.json({ code: 'UNAUTHENTICATED' }, { status: 401 });
  await act(async () => {
    await cache.refetchQueries({ queryKey: ['staff-session'] });
  });
  await waitFor(() => expect(screen.queryByLabelText('From date')).toBeNull());
});
