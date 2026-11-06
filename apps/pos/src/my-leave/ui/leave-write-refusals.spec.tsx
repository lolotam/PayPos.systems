import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
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
let readStatus = 503;
let readFailurePath = '';
let writeStatus = 409;
beforeEach(() => {
  onlineManager.setOnline(true);
  items = [...records];
  requests = [];
  failure = false;
  canCreate = true;
  readFailure = false;
  readStatus = 503;
  readFailurePath = '';
  writeStatus = 409;
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
        if (failure)
          return Response.json(
            { code: writeStatus === 409 ? 'LEAVE_OVERLAP' : 'FORBIDDEN' },
            { status: writeStatus },
          );
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
it.each([
  ['create', 401, 'personal'],
  ['create', 403, 'personal'],
  ['cancel', 401, 'personal'],
  ['cancel', 403, 'personal'],
  ['cancel', 404, 'personal'],
  ['create', 401, 'reception'],
  ['cancel', 403, 'reception'],
] as const)('clears private data when %s returns %i in %s', async (operation, status, mode) => {
  const view = mount({ ...context, mode, branch_id: branch });
  if (mode === 'personal') await chooseBranch();
  else await screen.findByText('Annual — Pending');
  dates();
  failure = true;
  writeStatus = status;
  fireEvent.click(
    screen.getByRole('button', {
      name: operation === 'create' ? 'Submit request' : 'Cancel request',
    }),
  );
  await screen.findAllByRole('alert');
  expect(screen.queryByText('Annual — Pending')).toBeNull();
  expect(screen.queryByLabelText('From date')).toBeNull();
  expect(JSON.stringify(view.cache.getQueriesData({ queryKey: ['my-leave'] }))).not.toContain(
    'Request declined',
  );
  if (status === 401) expect(screen.queryByLabelText('Branch')).toBeNull();
  else {
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByLabelText('From date');
    expect(screen.getByText('Annual \u2014 Pending')).toBeTruthy();
  }
});
