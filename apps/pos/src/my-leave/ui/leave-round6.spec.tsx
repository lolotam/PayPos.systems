import { act, fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/shared/locale/locale-context';
import { MyLeaveScreen } from './my-leave-screen';
import { recoverLeaveSession } from '@/app/recover-leave-session';
import type { LeaveContext } from '../model/context';

vi.mock('@/shared/api/device-auth', () => ({ currentDeviceToken: async () => 'paired-device' }));

const context: LeaveContext = {
  mode: 'personal',
  company_id: '10000000-0000-4000-8000-000000000001',
  business_id: '10000000-0000-4000-8000-000000000002',
  user_id: '10000000-0000-4000-8000-000000000003',
  employee_id: '10000000-0000-4000-8000-000000000004',
  expires_at: '2026-11-06T20:00:00Z',
  sessionEpoch: 0,
  timezone: 'Asia/Kuwait',
};
const branch = '00000000-0000-4000-8000-000000000001';
const alternate = '00000000-0000-4000-8000-000000000002';
let eligible = branch;
const records = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].map((status, index) => ({
  id: `leave-${index}`,
  from: '2026-12-01',
  to: '2026-12-02',
  kind: 'FULL_DAY',
  type: 'ANNUAL',
  status,
  timezone: 'Asia/Kuwait',
  revision: 1,
  can_cancel: index === 0,
  note: null as string | null,
  decision_reason: index === 2 ? 'Request declined' : null,
}));
let items = [...records];
let requests: Request[];
let failure = false;
let canCreate = true;
let readFailure = false;
let readStatus = 503;
let sessionUser = context.user_id;
let readFailurePath = '';
beforeEach(() => {
  onlineManager.setOnline(true);
  items = [...records];
  eligible = branch;
  requests = [];
  failure = false;
  canCreate = true;
  readFailure = false;
  readStatus = 503;
  readFailurePath = '';
  sessionUser = context.user_id;
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      requests.push(request);
      const url = new URL(request.url);
      if (request.method === 'GET' && readFailure && url.pathname.endsWith(readFailurePath))
        return Response.json(
          { code: readStatus === 503 ? 'NOT_READY' : 'FORBIDDEN' },
          { status: readStatus },
        );
      if (url.pathname.endsWith('/personal-session') || url.pathname.endsWith('/staff-session'))
        return Response.json({
          company_id: context.company_id,
          business_id: context.business_id,
          user_id: sessionUser,
          expires_at: context.expires_at,
          ...(url.pathname.endsWith('/personal-session')
            ? { employee_id: context.employee_id }
            : { branch_id: branch, device_id: '10000000-0000-4000-8000-000000000005' }),
        });
      if (url.pathname.endsWith('/branches'))
        return Response.json({
          items: [{ id: eligible, name_ar: 'Branch', name_en: 'Branch', timezone: 'Asia/Kuwait' }],
        });
      if (request.method === 'POST') {
        if (failure) return Response.json({ code: 'LEAVE_OVERLAP' }, { status: 409 });
        items = url.pathname.endsWith('/cancel')
          ? items.map((item) => ({ ...item, status: 'CANCELLED', can_cancel: false }))
          : [
              {
                ...(records[0] as (typeof records)[number]),
                id: 'new-request',
                note: 'New request',
              },
            ];
        return Response.json(items[0]);
      }
      return Response.json({
        items: url.searchParams.has('cursor')
          ? [{ ...(records[1] as (typeof records)[number]), id: 'older', note: 'Older page' }]
          : items,
        next_cursor: url.searchParams.has('cursor') ? null : branch,
        request_branch_ids: canCreate ? [eligible] : [],
      });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function mount(value = context, locale: 'ar' | 'en' = 'en') {
  const cache = new QueryClient();
  const tree = (next: LeaveContext) => (
    <QueryClientProvider client={cache}>
      <LocaleProvider locale={locale} setLocale={() => undefined}>
        <MyLeaveScreen
          context={next}
          recoverSession={(current, branch, signal) =>
            recoverLeaveSession(current, branch, signal, cache)
          }
        />
      </LocaleProvider>
    </QueryClientProvider>
  );
  return { ...render(tree(value)), tree, cache };
}
async function chooseBranch() {
  await screen.findByRole('option', { name: 'Branch' });
  fireEvent.change(screen.getByLabelText('Branch'), { target: { value: branch } });
  await screen.findByText('Annual \u2014 Pending');
}

it.each([403, 404])(
  'keeps branches HTTP%i latched across focus and rerender until retry',
  async (status) => {
    const view = mount();
    await chooseBranch();
    readFailure = true;
    readStatus = status;
    readFailurePath = 'branches';
    await act(async () => {
      await view.cache.refetchQueries({ queryKey: ['my-leave'] });
    });
    await screen.findByRole('button', { name: 'Retry' });
    const reads = requests.length;
    readFailure = false;
    view.rerender(view.tree({ ...context }));
    await act(async () => {
      const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      visibility.mockReturnValue('visible');
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
      await Promise.resolve();
    });
    expect(requests).toHaveLength(reads);
    expect(screen.queryByLabelText('Branch')).toBeNull();
    expect(screen.queryByLabelText('From date')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByLabelText('From date');
  },
);
it('shows confirmed cancellation without stale action after its refresh503', async () => {
  const view = mount();
  await chooseBranch();
  readFailure = true;
  readStatus = 503;
  readFailurePath = 'leave-requests';
  fireEvent.click(screen.getByRole('button', { name: 'Cancel request' }));
  await waitFor(() => expect(screen.queryByText('Annual \u2014 Pending')).toBeNull());
  await screen.findByRole('alert');
  expect(screen.queryByRole('button', { name: 'Cancel request' })).toBeNull();
  expect(screen.getAllByText('Annual \u2014 Cancelled')).toHaveLength(2);
  expect(JSON.stringify(view.cache.getQueriesData({ queryKey: ['my-leave'] }))).toContain(
    'CANCELLED',
  );
  const cached = view.cache.getQueriesData<{ pages?: { items: typeof records }[] }>({
    queryKey: ['my-leave'],
  });
  expect(
    cached
      .flatMap(([, data]) => data?.pages?.flatMap((page) => page.items) ?? [])
      .find((item) => item.id === 'leave-0'),
  ).toMatchObject({ status: 'CANCELLED', can_cancel: false });
});
it('shows a disabled branch Retry and loading feedback until the explicit read finishes', async () => {
  const view = mount();
  await chooseBranch();
  readFailure = true;
  readStatus = 403;
  readFailurePath = 'branches';
  await act(async () => {
    await view.cache.refetchQueries({ queryKey: ['my-leave'] });
  });
  await screen.findByRole('button', { name: 'Retry' });
  readFailure = false;
  const original = globalThis.fetch;
  let finish: (() => void) | undefined;
  vi.stubGlobal('fetch', async (request: Request) => {
    if (new URL(request.url).pathname.endsWith('/branches'))
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    return original(request);
  });
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Retry' }).hasAttribute('disabled')).toBe(true),
  );
  expect(screen.getByRole('status').textContent).toBeTruthy();
  expect(screen.queryByLabelText('From date')).toBeNull();
  await act(async () => {
    finish?.();
  });
  await screen.findByLabelText('From date');
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
});
it('recovers the same identity to an allowed alternative when the old branch was removed', async () => {
  const view = mount();
  await chooseBranch();
  readFailure = true;
  readStatus = 401;
  readFailurePath = 'leave-requests';
  await act(async () => {
    await view.cache.refetchQueries({ queryKey: ['my-leave'] });
  });
  await screen.findByRole('button', { name: 'Retry' });
  eligible = alternate;
  readFailure = false;
  const reads = requests.length;
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByLabelText('Branch');
  expect((screen.getByLabelText('Branch') as HTMLSelectElement).value).toBe('');
  expect(screen.queryByLabelText('From date')).toBeNull();
  expect(
    requests
      .slice(reads)
      .some((request) => new URL(request.url).searchParams.get('branch_id') === branch),
  ).toBe(false);
  fireEvent.change(screen.getByLabelText('Branch'), { target: { value: alternate } });
  await screen.findByLabelText('From date');
  expect(
    requests.some((request) => new URL(request.url).searchParams.get('branch_id') === alternate),
  ).toBe(true);
});
