import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { leaveDecisionRecord, leaveId } from '../api/leave-decision.fixture';
import { historyLeaveRow, historyPage, openPage } from '../api/leave-history.fixture';
import { EmployeeLeaveSection } from './employee-leave-section';

const state = vi.hoisted(() => ({ locale: 'en' as 'ar' | 'en' }));
const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));

type GetOptions = { params: { query: Record<string, unknown> } };
type GetResult =
  | { data: unknown }
  | {
      error: { code: string; message_en: string; message_ar: string };
      response: { status: number };
    };
type GetHandler = (query: Record<string, unknown>) => GetResult | Promise<GetResult>;
const props = {
  companyId: leaveId,
  businessId: leaveId,
  userId: leaveId,
  employeeId: leaveId,
  branches: [
    {
      id: leaveId,
      name_en: 'Synthetic branch',
      name_ar: null,
      is_active: true,
      effective_timezone: 'Asia/Kuwait',
    },
  ],
  timeZone: 'Asia/Kuwait',
};
let client: QueryClient;

function routeGets(handlers: { history?: GetHandler; open?: GetHandler } = {}) {
  const history = handlers.history ?? (() => ({ data: historyPage() }));
  const open = handlers.open ?? (() => ({ data: openPage() }));
  api.GET.mockImplementation(async (path: string, options: GetOptions) => {
    if (path.endsWith('/leave-history')) return history(options.params.query);
    if (path.endsWith('/leave-requests')) return open(options.params.query);
    throw new Error(`Unexpected GET ${path}`);
  });
}
function queries(pathEnd: string) {
  return api.GET.mock.calls
    .filter((call) => (call[0] as string).endsWith(pathEnd))
    .map((call) => (call[1] as GetOptions).params.query);
}
function renderSection() {
  return render(
    <QueryClientProvider client={client}>
      <EmployeeLeaveSection {...props} />
    </QueryClientProvider>,
  );
}
function openRegion() {
  return screen.getByRole('region', { name: t('en', 'leaveHistory.openTitle') });
}
function historyRegion() {
  return screen.getByRole('region', { name: t('en', 'leaveHistory.historyTitle') });
}
function failure(status: number): GetResult {
  return {
    error: {
      code: status === 400 ? 'VALIDATION_FAILED' : 'NOT_FOUND',
      message_en: 'Synthetic failure',
      message_ar: 'Synthetic failure',
    },
    response: { status },
  };
}
function openRequest() {
  return { ...leaveDecisionRecord, decision_reason: 'Synthetic open request', can_cancel: true };
}
function changeDate(label: 'leave.from' | 'leave.to', value: string) {
  fireEvent.change(within(historyRegion()).getByLabelText(t('en', label)), { target: { value } });
}
function applyFilters() {
  fireEvent.click(
    within(historyRegion()).getByRole('button', { name: t('en', 'leave.applyFilters') }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-24T09:00:00Z'));
  state.locale = 'en';
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  routeGets();
  api.POST.mockResolvedValue({ data: leaveDecisionRecord });
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('applies the type and status filters and shows only the matching rows', async () => {
  routeGets({
    history: (query) => {
      const filtered = query['types[]'] !== undefined;
      return {
        data: historyPage({
          items: [
            historyLeaveRow({
              note: filtered ? 'Synthetic filtered annual' : 'Synthetic unfiltered sick',
              type: filtered ? 'ANNUAL' : 'SICK',
              status: filtered ? 'APPROVED' : 'REJECTED',
            }),
          ],
        }),
      };
    },
  });
  renderSection();
  await screen.findByText('Synthetic unfiltered sick');
  fireEvent.change(within(historyRegion()).getByRole('combobox', { name: t('en', 'leave.type') }), {
    target: { value: 'ANNUAL' },
  });
  fireEvent.change(
    within(historyRegion()).getByRole('combobox', { name: t('en', 'leave.status') }),
    {
      target: { value: 'APPROVED' },
    },
  );
  applyFilters();
  await screen.findByText('Synthetic filtered annual');
  expect(screen.queryByText('Synthetic unfiltered sick')).toBeNull();
  expect(queries('/leave-history').at(-1)).toMatchObject({
    'types[]': ['ANNUAL'],
    'statuses[]': ['APPROVED'],
  });
});

it('sends no empty filter arrays by default', async () => {
  routeGets({ history: () => ({ data: historyPage({ items: [historyLeaveRow()] }) }) });
  renderSection();
  await screen.findByText('Synthetic past annual');
  const query = queries('/leave-history')[0];
  expect(query).toMatchObject({ from: '2026-01-01', to: '2026-10-24', limit: 20 });
  expect(query).not.toHaveProperty('types[]');
  expect(query).not.toHaveProperty('statuses[]');
});

it('refuses a period longer than 366 days with an alert and sends no request', async () => {
  renderSection();
  await screen.findByRole('button', { name: t('en', 'leave.submit') });
  const count = queries('/leave-history').length;
  changeDate('leave.from', '2024-01-01');
  changeDate('leave.to', '2026-10-24');
  applyFilters();
  expect((await within(historyRegion()).findByRole('alert')).textContent).toBe(
    t('en', 'leaveHistory.rangeInvalid'),
  );
  expect(queries('/leave-history')).toHaveLength(count);
});

it('refuses an end date before the start', async () => {
  renderSection();
  await screen.findByRole('button', { name: t('en', 'leave.submit') });
  const count = queries('/leave-history').length;
  changeDate('leave.from', '2026-10-25');
  applyFilters();
  expect((await within(historyRegion()).findByRole('alert')).textContent).toBe(
    t('en', 'leaveHistory.rangeInvalid'),
  );
  expect(queries('/leave-history')).toHaveLength(count);
});

it('pages through the history with the cursor', async () => {
  routeGets({
    history: (query) => ({
      data: historyPage({
        items: [
          historyLeaveRow({ note: query.cursor ? 'Synthetic page two' : 'Synthetic page one' }),
        ],
        next_cursor: query.cursor ? null : 'cursor-2',
      }),
    }),
  });
  renderSection();
  await screen.findByText('Synthetic page one');
  fireEvent.click(within(historyRegion()).getByRole('button', { name: t('en', 'leave.next') }));
  await screen.findByText('Synthetic page two');
  expect(queries('/leave-history').at(-1)).toMatchObject({ cursor: 'cursor-2' });
  fireEvent.click(within(historyRegion()).getByRole('button', { name: t('en', 'leave.previous') }));
  await screen.findByText('Synthetic page one');
  expect(queries('/leave-history').at(-1)).not.toHaveProperty('cursor');
});

it('shows an empty message when the period has no rows', async () => {
  renderSection();
  expect(await screen.findByText(t('en', 'leaveHistory.historyEmpty'))).toBeTruthy();
});

it('a history 404 shows an alert in the history part while the open list still works', async () => {
  routeGets({
    history: () => failure(404),
    open: () => ({ data: openPage({ items: [openRequest()] }) }),
  });
  renderSection();
  await screen.findByText('Synthetic open request');
  expect(within(historyRegion()).getByRole('alert')).toBeTruthy();
  expect(within(openRegion()).getByText('Synthetic open request')).toBeTruthy();
  expect(within(openRegion()).getByRole('button', { name: t('en', 'leave.cancel') })).toBeTruthy();
  expect(queries('/leave-requests').at(-1)).toMatchObject({ open: 'true' });
  expect(queries('/leave-requests').at(-1)).not.toHaveProperty('as_of');
});

it('a history 400 shows an alert and Previous page restarts at page one', async () => {
  routeGets({
    history: (query) =>
      query.cursor
        ? failure(400)
        : {
            data: historyPage({
              items: [historyLeaveRow({ note: 'Synthetic page one' })],
              next_cursor: 'cursor-2',
            }),
          },
  });
  renderSection();
  await screen.findByText('Synthetic page one');
  fireEvent.click(within(historyRegion()).getByRole('button', { name: t('en', 'leave.next') }));
  expect(await within(historyRegion()).findByRole('alert')).toBeTruthy();
  fireEvent.click(within(historyRegion()).getByRole('button', { name: t('en', 'leave.previous') }));
  await screen.findByText('Synthetic page one');
  expect(queries('/leave-history').at(-1)).not.toHaveProperty('cursor');
});

it('the filter form stays usable while the history reloads', async () => {
  const pending = new Promise<GetResult>(() => {});
  routeGets({
    history: (query) =>
      query['types[]']
        ? pending
        : {
            data: historyPage({ items: [historyLeaveRow({ note: 'Synthetic initial row' })] }),
          },
    open: () => ({ data: openPage({ items: [openRequest()] }) }),
  });
  renderSection();
  await screen.findByText('Synthetic open request');
  fireEvent.change(within(historyRegion()).getByRole('combobox', { name: t('en', 'leave.type') }), {
    target: { value: 'ANNUAL' },
  });
  applyFilters();
  expect(within(historyRegion()).getByLabelText(t('en', 'leave.from'))).toBeTruthy();
  expect(within(openRegion()).getByText('Synthetic open request')).toBeTruthy();
});

it('keeps the open list rows visible while a new history page loads', async () => {
  const pending = new Promise<GetResult>(() => {});
  routeGets({
    history: (query) =>
      query.cursor
        ? pending
        : {
            data: historyPage({
              items: [historyLeaveRow({ note: 'Synthetic page one' })],
              next_cursor: 'cursor-2',
            }),
          },
    open: () => ({ data: openPage({ items: [openRequest()] }) }),
  });
  renderSection();
  await screen.findByText('Synthetic page one');
  fireEvent.click(within(historyRegion()).getByRole('button', { name: t('en', 'leave.next') }));
  expect(within(openRegion()).getByText('Synthetic open request')).toBeTruthy();
  expect(within(historyRegion()).getByLabelText(t('en', 'leave.from'))).toBeTruthy();
  await waitFor(() =>
    expect(queries('/leave-history').at(-1)).toMatchObject({ cursor: 'cursor-2' }),
  );
});
