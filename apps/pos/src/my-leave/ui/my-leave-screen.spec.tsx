import { act, fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { t } from '@pospay/i18n';
import { LocaleProvider } from '@/shared/locale/locale-context';
import { MyLeaveScreen } from './my-leave-screen';
import type { LeaveContext } from '../model/context';

vi.mock('@/shared/api/device-auth', () => ({ currentDeviceToken: async () => 'paired-device' }));

const context: LeaveContext = {
  mode: 'personal',
  company_id: 'company',
  business_id: 'business',
  user_id: 'user',
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
beforeEach(() => {
  onlineManager.setOnline(true);
  items = [...records];
  requests = [];
  failure = false;
  canCreate = true;
  readFailure = false;
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      requests.push(request);
      const url = new URL(request.url);
      if (request.method === 'GET' && readFailure)
        return Response.json({ code: 'NOT_READY' }, { status: 503 });
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
        <MyLeaveScreen context={next} />
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
it('shows all statuses and reasons, keeps previous pages, and exposes only allowed cancellation', async () => {
  mount();
  await chooseBranch();
  for (const status of ['Pending', 'Approved', 'Rejected', 'Cancelled'])
    expect(screen.getByText(`Annual \u2014 ${status}`)).toBeTruthy();
  expect(screen.getByText('Decision reason: Request declined')).toBeTruthy();
  expect(screen.getAllByRole('button', { name: 'Cancel request' })).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  await screen.findByText('Older page');
  expect(screen.getByText('Annual \u2014 Pending')).toBeTruthy();
  expect(
    requests.every(
      (request) =>
        request.credentials === 'include' &&
        request.cache === 'no-store' &&
        !request.headers.has('Authorization'),
    ),
  ).toBe(true);
});
it.each(['FULL_DAY', 'PARTIAL'])(
  'creates %s and refreshes visible history without a PIN',
  async (kind) => {
    mount();
    await chooseBranch();
    if (kind === 'FULL_DAY') dates();
    else {
      fireEvent.change(screen.getByLabelText('Unit'), { target: { value: 'PARTIAL' } });
      for (const [label, value] of [
        ['Date', '2026-12-01'],
        ['Start time', '10:00'],
        ['End time', '10:30'],
      ])
        fireEvent.change(screen.getByLabelText(label ?? ''), { target: { value } });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
    await screen.findByText('Leave request saved');
    await screen.findByText('New request');
    expect(screen.queryByLabelText(/PIN/i)).toBeNull();
  },
);
it('cancels using revision and refreshes status', async () => {
  mount();
  await chooseBranch();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel request' }));
  await screen.findByText('Leave request cancelled');
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancel request' })).toBeNull());
  const request = requests.find((item) => item.method === 'POST') as Request;
  expect(await request.clone().json()).toEqual({ expected_revision: 1 });
});
it('keeps history and allowed cancellation without offering unauthorized creation', async () => {
  canCreate = false;
  mount();
  await chooseBranch();
  expect(screen.queryByRole('button', { name: 'Submit request' })).toBeNull();
  expect(screen.queryByLabelText('From date')).toBeNull();
  expect(screen.getByText('Annual — Approved')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Cancel request' })).toBeTruthy();
});
it('retains the draft through transient history and branch background failures', async () => {
  const view = mount();
  await chooseBranch();
  dates();
  readFailure = true;
  await act(async () => {
    await view.cache.refetchQueries({ queryKey: ['my-leave'] });
  });
  await screen.findAllByRole('alert');
  expect((screen.getByLabelText('From date') as HTMLInputElement).value).toBe('2026-12-01');
  expect(screen.getByText('Annual — Pending')).toBeTruthy();
  readFailure = false;
  await act(async () => {
    await view.cache.refetchQueries({ queryKey: ['my-leave'] });
  });
  expect((screen.getByLabelText('From date') as HTMLInputElement).value).toBe('2026-12-01');
  await waitFor(() => expect(screen.queryAllByRole('alert')).toHaveLength(0));
});
it('retries an initial branch read failure without reopening the screen', async () => {
  readFailure = true;
  mount();
  await screen.findByRole('alert');
  readFailure = false;
  fireEvent.click(screen.getByRole('button', { name: t('en', 'myLeave.retry') }));
  await chooseBranch();
  expect(screen.getByRole('button', { name: 'Submit request' })).toBeTruthy();
});
it('polls external decisions and shows the selected timezone even with empty history', async () => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
  try {
    mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    fireEvent.change(screen.getByLabelText('Branch'), { target: { value: branch } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(screen.getByRole('button', { name: 'Cancel request' })).toBeTruthy();
    expect(screen.getByText(`${t('en', 'leave.timezone')}: Asia/Kuwait`)).toBeTruthy();
    items = items.map((item) => ({ ...item, status: 'APPROVED', can_cancel: false }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(screen.queryByRole('button', { name: 'Cancel request' })).toBeNull();
    expect(screen.queryByText('Annual — Pending')).toBeNull();
    items = [];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(screen.getByText(t('en', 'leave.empty'))).toBeTruthy();
    expect(screen.getByText(`${t('en', 'leave.timezone')}: Asia/Kuwait`)).toBeTruthy();
  } finally {
    vi.useRealTimers();
  }
});
it('shows named failure and preserves the idempotency key on an explicit retry', async () => {
  mount();
  await chooseBranch();
  dates();
  failure = true;
  fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('alert').textContent).toBe(t('en', 'errors.LEAVE_OVERLAP'));
  fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
  await waitFor(() => expect(requests.filter((item) => item.method === 'POST')).toHaveLength(2));
  const writes = requests.filter((item) => item.method === 'POST');
  expect(writes[0]?.headers.get('Idempotency-Key')).toBe(writes[1]?.headers.get('Idempotency-Key'));
});
it('clears records and form on identity change and offline transitions', async () => {
  const view = mount();
  await chooseBranch();
  dates();
  view.rerender(view.tree({ ...context, user_id: 'another', sessionEpoch: 1 }));
  expect(screen.queryByText('Annual \u2014 Pending')).toBeNull();
  expect(screen.queryByLabelText('From date')).toBeNull();
  await chooseBranch();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  act(() => window.dispatchEvent(new Event('offline')));
  expect(screen.getByRole('status').textContent).toContain('Internet required');
  expect(screen.queryByText('Annual \u2014 Pending')).toBeNull();
});

it('opens reception leave directly using the paired branch without another PIN', async () => {
  mount({ ...context, mode: 'reception', branch_id: branch });
  await screen.findByText('Annual \u2014 Pending');
  expect(screen.queryByLabelText('Branch')).toBeNull();
  expect(screen.queryByLabelText(/PIN/i)).toBeNull();
  expect(screen.getByText(`${t('en', 'leave.timezone')}: Asia/Kuwait`)).toBeTruthy();
  expect(
    requests.some((request) => request.headers.get('Authorization') === 'Device paired-device'),
  ).toBe(true);
  expect(requests.every((request) => !new URL(request.url).searchParams.has('branch_id'))).toBe(
    true,
  );
});
it('shows the empty history and Arabic controls', async () => {
  items = [];
  mount({ ...context, mode: 'reception', branch_id: branch }, 'ar');
  await screen.findByText(t('ar', 'leave.empty'));
  expect(screen.getByRole('heading', { name: t('ar', 'myLeave.title') })).toBeTruthy();
  expect(screen.getByRole('button', { name: t('ar', 'leave.submit') })).toBeTruthy();
  expect(screen.getByRole('region', { name: t('ar', 'myLeave.title') }).getAttribute('dir')).toBe(
    'rtl',
  );
});
it('drops the old form and history when the selected branch changes', async () => {
  mount();
  await chooseBranch();
  dates();
  fireEvent.change(screen.getByLabelText('Branch'), { target: { value: '' } });
  expect(screen.queryByText('Annual \u2014 Pending')).toBeNull();
  expect(screen.queryByLabelText('From date')).toBeNull();
});

it.each([
  ['FULL_DAY', '2027-03-01', '00:00', '00:00'],
  ['PARTIAL', '2026-12-01', '10:05', '10:30'],
  ['PARTIAL', '2026-12-01', '11:00', '10:30'],
])('rejects invalid period %s %s %s %s with visible guidance', async (kind, end, start, finish) => {
  mount();
  await chooseBranch();
  if (kind === 'FULL_DAY') {
    dates();
    fireEvent.change(screen.getByLabelText('Through date'), { target: { value: end } });
  } else {
    fireEvent.change(screen.getByLabelText('Unit'), { target: { value: kind } });
    for (const [label, value] of [
      ['Date', end],
      ['Start time', start],
      ['End time', finish],
    ])
      fireEvent.change(screen.getByLabelText(label ?? ''), { target: { value } });
  }
  fireEvent.submit(
    screen.getByRole('button', { name: 'Submit request' }).closest('form') as HTMLFormElement,
  );
  await screen.findByText(t('en', 'myLeave.invalid'));
  expect(requests.filter((request) => request.method === 'POST')).toHaveLength(0);
});

it('ignores a late history response after the employee session changes', async () => {
  const original = globalThis.fetch;
  let release: (response: Response) => void = () => undefined;
  const pending = new Promise<Response>((resolve) => {
    release = resolve;
  });
  vi.stubGlobal('fetch', async (request: Request) => {
    if (new URL(request.url).pathname.endsWith('/leave-requests')) return pending;
    return original(request);
  });
  const view = mount();
  await screen.findByRole('option', { name: 'Branch' });
  fireEvent.change(screen.getByLabelText('Branch'), { target: { value: branch } });
  await screen.findByRole('status');
  view.rerender(view.tree({ ...context, user_id: 'new-user', sessionEpoch: 2 }));
  await act(async () => {
    release(
      Response.json({
        items: [{ ...records[0], note: 'Old employee private note' }],
        next_cursor: null,
      }),
    );
  });
  expect(screen.queryByText('Old employee private note')).toBeNull();
  expect(screen.queryByLabelText('From date')).toBeNull();
});
