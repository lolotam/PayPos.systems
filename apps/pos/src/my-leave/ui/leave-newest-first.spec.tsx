import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
const row = (id: string, note: string, status: string, canCancel = false) => ({
  id,
  from: '2026-12-01',
  to: '2026-12-02',
  kind: 'FULL_DAY',
  type: 'ANNUAL',
  status,
  timezone: 'Asia/Kuwait',
  revision: 1,
  can_cancel: canCancel,
  note,
  decision_reason: null,
});
type StubRow = ReturnType<typeof row>;
let firstPage: StubRow[];
const newerRow = (): StubRow => ({
  ...(firstPage[0] as StubRow),
  id: 'leave-brand-new',
  note: 'brand new note',
});
const olderPage: StubRow[] = [
  row('leave-older-1', 'older first note', 'APPROVED'),
  row('leave-older-2', 'older second note', 'CANCELLED'),
];
let created: boolean;
beforeEach(() => {
  onlineManager.setOnline(true);
  created = false;
  firstPage = [
    row('leave-newest', 'newest request note', 'PENDING', true),
    row('leave-second', 'second newest note', 'APPROVED'),
    row('leave-third', 'third newest note', 'REJECTED'),
  ];
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const url = new URL(request.url);
      if (url.pathname.endsWith('/branches'))
        return Response.json({
          items: [{ id: branch, name_ar: 'Branch', name_en: 'Branch', timezone: 'Asia/Kuwait' }],
        });
      if (request.method === 'POST') {
        created = true;
        return Response.json(newerRow());
      }
      if (url.searchParams.has('cursor'))
        return Response.json({ items: olderPage, next_cursor: null, request_branch_ids: [branch] });
      return Response.json({
        items: created ? [newerRow(), ...firstPage] : firstPage,
        next_cursor: 'cursor-token',
        request_branch_ids: [branch],
      });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function mount() {
  const cache = new QueryClient();
  const tree = (
    <QueryClientProvider client={cache}>
      <LocaleProvider locale="en" setLocale={() => undefined}>
        <MyLeaveScreen
          context={context}
          recoverSession={(current, branch, signal) =>
            recoverLeaveSession(current, branch, signal, cache)
          }
        />
      </LocaleProvider>
    </QueryClientProvider>
  );
  return { ...render(tree), cache };
}
async function chooseBranch() {
  await screen.findByRole('option', { name: 'Branch' });
  fireEvent.change(screen.getByLabelText('Branch'), { target: { value: branch } });
  await screen.findByText('Annual \u2014 Pending');
}
function visibleOrder() {
  return within(screen.getByRole('list'))
    .getAllByRole('listitem')
    .map((item) => item.textContent);
}
it('lists the newest first on screen and keeps earlier pages above the next page', async () => {
  mount();
  await chooseBranch();
  expect(visibleOrder()).toEqual([
    expect.stringContaining('newest request note'),
    expect.stringContaining('second newest note'),
    expect.stringContaining('third newest note'),
  ]);
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  await screen.findByText('older first note');
  expect(visibleOrder()).toEqual([
    expect.stringContaining('newest request note'),
    expect.stringContaining('second newest note'),
    expect.stringContaining('third newest note'),
    expect.stringContaining('older first note'),
    expect.stringContaining('older second note'),
  ]);
});
it('shows the created request at the top of the history once the first page is refetched', async () => {
  const view = mount();
  await chooseBranch();
  fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-12-01' } });
  fireEvent.change(screen.getByLabelText('Through date'), { target: { value: '2026-12-02' } });
  fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
  await screen.findByText('Leave request saved');
  await act(async () => {
    await view.cache.refetchQueries({ queryKey: ['my-leave'] });
  });
  expect(visibleOrder()[0]).toContain('brand new note');
  expect(visibleOrder()[1]).toContain('newest request note');
});
