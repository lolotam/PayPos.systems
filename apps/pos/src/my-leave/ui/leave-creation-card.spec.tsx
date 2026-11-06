import { act, fireEvent, render, screen, waitFor, cleanup, within } from '@testing-library/react';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/shared/locale/locale-context';
import { MyLeaveScreen } from './my-leave-screen';
import { recoverLeaveSession } from '@/app/recover-leave-session';
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
let readStatus = 503;
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
it('keeps the creation card through a local cancellation and failed history refresh', async () => {
  const original = globalThis.fetch;
  let failRead = false;
  vi.stubGlobal('fetch', async (request: Request) => {
    const path = new URL(request.url).pathname;
    if (request.method === 'POST' && !path.endsWith('/cancel'))
      return Response.json({ ...records[0], id: 'new-request', note: 'Just submitted' });
    if (request.method === 'GET' && path.endsWith('/leave-requests') && failRead)
      return Response.json({ code: 'NOT_READY' }, { status: 503 });
    return original(request);
  });
  const view = mount();
  await chooseBranch();
  dates();
  fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
  await screen.findByRole('region', { name: 'Latest request' });
  failRead = true;
  fireEvent.click(screen.getByRole('button', { name: 'Cancel request' }));
  await screen.findByRole('alert');
  const card = screen.getByRole('region', { name: 'Latest request' });
  expect(within(card).getByText('Annual — Pending')).toBeTruthy();
  expect(within(card).getByText('Just submitted')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Cancel request' })).toBeNull();
  failRead = false;
  await act(async () => {
    await view.cache.refetchQueries({
      predicate: (query) => query.queryKey[0] === 'my-leave' && query.queryKey[2] === branch,
    });
  });
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Latest request' })).toBeNull());
});
it('keeps the creation card when a history read started before creation finishes later', async () => {
  const original = globalThis.fetch;
  let finish: (() => void) | undefined;
  let hold = false;
  vi.stubGlobal('fetch', async (request: Request) => {
    if (request.method === 'POST')
      return Response.json({ ...records[0], id: 'new-request', note: 'Concurrent creation' });
    if (hold && new URL(request.url).pathname.endsWith('/leave-requests'))
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    return original(request);
  });
  const view = mount();
  await chooseBranch();
  hold = true;
  let pending: Promise<void> | undefined;
  act(() => {
    pending = view.cache.refetchQueries({
      predicate: (query) => query.queryKey[0] === 'my-leave' && query.queryKey[2] === branch,
    });
  });
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  dates();
  fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
  await screen.findByRole('region', { name: 'Latest request' });
  await act(async () => {
    finish?.();
    await pending;
  });
  expect(
    within(screen.getByRole('region', { name: 'Latest request' })).getByText('Concurrent creation'),
  ).toBeTruthy();
  hold = false;
  await act(async () => {
    await view.cache.refetchQueries({
      predicate: (query) => query.queryKey[0] === 'my-leave' && query.queryKey[2] === branch,
    });
  });
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Latest request' })).toBeNull());
});
it('pins the returned request status above an older first page until the next history refresh', async () => {
  const approved = records[1] as (typeof records)[number];
  items = Array.from({ length: 20 }, (_, index) => ({ ...approved, id: `older-${index}` }));
  const original = globalThis.fetch;
  vi.stubGlobal('fetch', async (request: Request) =>
    request.method === 'POST'
      ? Response.json({ ...records[0], id: 'new-request', note: 'Just submitted' })
      : original(request),
  );
  const view = mount();
  await screen.findByRole('option', { name: 'Branch' });
  fireEvent.change(screen.getByLabelText('Branch'), { target: { value: branch } });
  await screen.findAllByText('Annual — Approved');
  dates();
  fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
  const card = await screen.findByRole('region', { name: 'Latest request' });
  expect(within(card).getByText('Annual — Pending')).toBeTruthy();
  expect(within(card).getByText('Just submitted')).toBeTruthy();
  expect(screen.getAllByText('Annual — Approved')).toHaveLength(20);
  await act(async () => {
    await view.cache.refetchQueries({ queryKey: ['my-leave'] });
  });
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Latest request' })).toBeNull());
});
