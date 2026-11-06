import { act, fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { t } from '@pospay/i18n';
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
          items: [{ id: branch, name_ar: 'Branch', name_en: 'Branch', timezone: 'Asia/Kuwait' }],
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
        request_branch_ids: canCreate ? [branch] : [],
      });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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
function dates() {
  fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-12-01' } });
  fireEvent.change(screen.getByLabelText('Through date'), { target: { value: '2026-12-02' } });
}

it.each(['personal', 'reception'] as const)(
  'recovers %s after401 only on successful explicit verification',
  async (mode) => {
    const view = mount({ ...context, mode, branch_id: branch });
    if (mode === 'personal') await chooseBranch();
    else await screen.findByText('Annual \u2014 Pending');
    dates();
    readFailure = true;
    readStatus = 401;
    readFailurePath = 'leave-requests';
    await act(async () => {
      await view.cache.refetchQueries({ queryKey: ['my-leave'] });
    });
    await waitFor(() => expect(screen.queryByLabelText('From date')).toBeNull());
    expect(screen.queryByLabelText('Branch')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Retry' }).hasAttribute('disabled')).toBe(false),
    );
    expect(screen.queryByLabelText('From date')).toBeNull();
    readFailure = false;
    sessionUser = 'different-user';
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Retry' }).hasAttribute('disabled')).toBe(false),
    );
    expect(screen.queryByLabelText('From date')).toBeNull();
    sessionUser = context.user_id;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByLabelText('From date');
    expect(screen.getByText('Annual \u2014 Pending')).toBeTruthy();
  },
);
it('timezone arrival preserves a reception refusal until explicit retry', async () => {
  const initial: LeaveContext = { ...context, mode: 'reception', branch_id: branch };
  delete initial.timezone;
  const view = mount(initial);
  await screen.findByText('Annual \u2014 Pending');
  readFailure = true;
  readStatus = 403;
  readFailurePath = 'leave-requests';
  await act(async () => {
    await view.cache.refetchQueries({ queryKey: ['my-leave'] });
  });
  await screen.findByRole('button', { name: 'Retry' });
  const reads = requests.length;
  readFailure = false;
  view.rerender(view.tree({ ...initial, timezone: 'Asia/Kuwait' }));
  await act(async () => {
    await Promise.resolve();
  });
  expect(requests).toHaveLength(reads);
  expect(screen.queryByText('Annual \u2014 Pending')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByLabelText('From date');
  expect(screen.getByText('Annual \u2014 Pending')).toBeTruthy();
});
it('clears the stale root period error when an edited date corrects it', async () => {
  mount();
  await chooseBranch();
  dates();
  fireEvent.change(screen.getByLabelText('Through date'), { target: { value: '2026-11-30' } });
  fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
  expect((await screen.findByRole('alert')).textContent).toBe(t('en', 'myLeave.invalid'));
  fireEvent.change(screen.getByLabelText('Through date'), { target: { value: '2026-12-02' } });
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(requests.every((request) => request.method === 'GET')).toBe(true);
});
