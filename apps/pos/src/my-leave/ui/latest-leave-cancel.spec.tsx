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
const pending = (id: string, canCancel: boolean, note: string | null) => ({
  id,
  from: '2026-12-01',
  to: '2026-12-02',
  kind: 'FULL_DAY',
  type: 'ANNUAL',
  status: 'PENDING',
  timezone: 'Asia/Kuwait',
  revision: 1,
  can_cancel: canCancel,
  note,
  decision_reason: null,
});
const cancelledRecord = (id: string) => ({
  ...pending(id, false, 'Just submitted'),
  status: 'CANCELLED',
  can_cancel: false,
});
let items: ReturnType<typeof pending>[];
let created: ReturnType<typeof pending>;
let refreshFails = false;
let parkCancel = false;
let parkRefresh = false;
let releaseCancel: ((response: Response) => void) | undefined;
let releaseRefresh: ((response: Response) => void) | undefined;
let cancelRequests: Request[];
let writeFailure: { status: number; code: string } | undefined;
beforeEach(() => {
  onlineManager.setOnline(true);
  items = [];
  created = pending('new-request', true, 'Just submitted');
  refreshFails = false;
  parkCancel = false;
  parkRefresh = false;
  releaseCancel = undefined;
  releaseRefresh = undefined;
  cancelRequests = [];
  writeFailure = undefined;
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const url = new URL(request.url);
      if (url.pathname.endsWith('/branches'))
        return Response.json({
          items: [{ id: branch, name_ar: 'Branch', name_en: 'Branch', timezone: 'Asia/Kuwait' }],
        });
      if (request.method === 'POST' && url.pathname.endsWith('/cancel')) {
        cancelRequests.push(request);
        if (writeFailure)
          return Response.json({ code: writeFailure.code }, { status: writeFailure.status });
        const id = url.pathname.split('/').at(-2) as string;
        const response = Response.json(cancelledRecord(id));
        if (parkCancel)
          return new Promise<Response>((resolve) => {
            releaseCancel = resolve;
          });
        return response;
      }
      if (request.method === 'POST') return Response.json(created);
      if (refreshFails) return Response.json({ code: 'NOT_READY' }, { status: 503 });
      if (parkRefresh)
        return new Promise<Response>((resolve) => {
          releaseRefresh = resolve;
        });
      return Response.json({ items, next_cursor: null, request_branch_ids: [branch] });
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
async function chooseBranch(loaded: string) {
  await screen.findByRole('option', { name: 'Branch' });
  fireEvent.change(screen.getByLabelText('Branch'), { target: { value: branch } });
  await screen.findByText(loaded);
}
function dates() {
  fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-12-01' } });
  fireEvent.change(screen.getByLabelText('Through date'), { target: { value: '2026-12-02' } });
}
const cancelButtons = () =>
  screen.queryAllByRole('button', { name: 'Cancel request' }) as HTMLButtonElement[];

it('the card cancels the shown request and shows the confirmed result before the history refresh', async () => {
  mount();
  await chooseBranch('No leave requests');
  dates();
  fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
  await screen.findByRole('region', { name: 'Latest request' });
  expect(cancelButtons()).toHaveLength(1);
  parkCancel = true;
  parkRefresh = true;
  fireEvent.click(cancelButtons()[0] as HTMLButtonElement);
  await waitFor(() => expect(cancelButtons()[0]?.disabled).toBe(true));
  const cancel = cancelRequests[0] as Request;
  expect(new URL(cancel.url).pathname).toBe('/v1/staff/me/leave-requests/new-request/cancel');
  expect(await cancel.json()).toEqual({ expected_revision: 1 });
  parkCancel = false;
  await act(async () => {
    releaseCancel?.(Response.json(cancelledRecord('new-request')));
  });
  await screen.findByText('Annual — Cancelled');
  expect(cancelButtons()).toHaveLength(0);
  parkRefresh = false;
  await act(async () => {
    releaseRefresh?.(Response.json({ items, next_cursor: null, request_branch_ids: [branch] }));
  });
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Latest request' })).toBeNull());
});

it('a card without server cancel authority renders no cancel button', async () => {
  mount();
  created = pending('new-request', false, 'Just submitted');
  await chooseBranch('No leave requests');
  dates();
  fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
  await screen.findByRole('region', { name: 'Latest request' });
  expect(cancelButtons()).toHaveLength(0);
});

it('a failed history refresh keeps the confirmed cancelled card without a button', async () => {
  mount();
  await chooseBranch('No leave requests');
  dates();
  fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
  await screen.findByRole('region', { name: 'Latest request' });
  refreshFails = true;
  fireEvent.click(cancelButtons()[0] as HTMLButtonElement);
  await screen.findByRole('alert');
  const card = screen.getByRole('region', { name: 'Latest request' });
  expect(within(card).getByText('Annual — Cancelled')).toBeTruthy();
  expect(cancelButtons()).toHaveLength(0);
});

it('cancelling the same request from its history row replaces the card too', async () => {
  mount();
  items = [pending('new-request', true, 'Just submitted')];
  await chooseBranch('Annual \u2014 Pending');
  dates();
  fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
  await screen.findByRole('region', { name: 'Latest request' });
  expect(cancelButtons()).toHaveLength(2);
  parkRefresh = true;
  fireEvent.click(cancelButtons()[1] as HTMLButtonElement);
  await waitFor(() => expect(cancelButtons()).toHaveLength(0));
  const card = screen.getByRole('region', { name: 'Latest request' });
  expect(within(card).getByText('Annual — Cancelled')).toBeTruthy();
  parkRefresh = false;
  await act(async () => {
    releaseRefresh?.(Response.json({ items, next_cursor: null, request_branch_ids: [branch] }));
  });
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Latest request' })).toBeNull());
});

it.each([
  { status: 403, code: 'FORBIDDEN' },
  { status: 404, code: 'NOT_FOUND' },
])(
  'a card cancel refused with $status clears private data exactly as today',
  async ({ status, code }) => {
    mount();
    writeFailure = { status, code };
    await chooseBranch('No leave requests');
    dates();
    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
    await screen.findByRole('region', { name: 'Latest request' });
    fireEvent.click(cancelButtons()[0] as HTMLButtonElement);
    await screen.findAllByRole('alert');
    expect(screen.queryByRole('region', { name: 'Latest request' })).toBeNull();
    expect(screen.queryByLabelText('From date')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByLabelText('From date');
  },
);

it('a 409 cancel shows its error and keeps the history', async () => {
  mount();
  writeFailure = { status: 409, code: 'LEAVE_REVISION_CONFLICT' };
  items = [pending('existing', true, 'History row')];
  await chooseBranch('Annual \u2014 Pending');
  dates();
  fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
  const card = await screen.findByRole('region', { name: 'Latest request' });
  fireEvent.click(within(card).getByRole('button', { name: 'Cancel request' }));
  await screen.findByRole('alert');
  expect(within(card).getByText('Just submitted')).toBeTruthy();
  expect(screen.getByText('History row')).toBeTruthy();
  expect(cancelButtons()).toHaveLength(2);
});
