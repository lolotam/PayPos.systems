import { formatDate, t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { leaveId } from '../api/leave-decision.fixture';
import { absenceRow, coveredRow, historyLeaveRow, historyPage } from '../api/leave-history.fixture';
import {
  branches,
  employeeListItem,
  employeesPage,
  envelopeFailure,
} from '../api/leave-report.fixture';
import { LeaveReportPage } from './leave-report-page';

const state = vi.hoisted(() => ({ locale: 'en' as 'ar' | 'en' }));
const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));

type GetOptions = { params: { query: Record<string, unknown> } };
type GetResult =
  | { data: unknown }
  | {
      error: { code: string; message_ar: string; message_en: string };
      response: { status: number };
    };
type Handler = (query: Record<string, unknown>) => GetResult;

const scope = { companyId: leaveId, businessId: leaveId, userId: leaveId };
const expiredCursor = {
  error: {
    code: 'VALIDATION_FAILED',
    message_ar: 'Synthetic expired cursor',
    message_en: 'Synthetic expired cursor',
    details: [{ path: ['cursor'], code: 'custom' }],
  },
  response: { status: 400 },
};
let client: QueryClient;

function routeGets(handlers: { history?: Handler; employees?: Handler } = {}) {
  const history = handlers.history ?? (() => ({ data: historyPage() }));
  const employees = handlers.employees ?? (() => ({ data: employeesPage([employeeListItem()]) }));
  api.GET.mockImplementation(async (path: string, options: GetOptions) => {
    if (path.endsWith('/leave-history')) return history(options.params.query);
    if (path.endsWith('/employees')) return employees(options.params.query);
    throw new Error(`Unexpected GET ${path}`);
  });
}

function queries(pathEnd: string) {
  return api.GET.mock.calls
    .filter((call) => (call[0] as string).endsWith(pathEnd))
    .map((call) => (call[1] as GetOptions).params.query);
}

function renderPage() {
  return render(
    <QueryClientProvider client={client}>
      <LeaveReportPage scope={scope} branches={branches} />
    </QueryClientProvider>,
  );
}

function day(value: string) {
  return formatDate(new Date(`${value}T12:00:00Z`), {
    locale: 'en',
    calendar: 'gregorian',
    timeZone: 'UTC',
  });
}

function applyFilters() {
  fireEvent.click(screen.getByRole('button', { name: t('en', 'leave.applyFilters') }));
}

function rows() {
  return within(screen.getByRole('table'));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-24T22:30:00Z'));
  state.locale = 'en';
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  routeGets();
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.useRealTimers();
});

it('shows the leave history report heading', () => {
  renderPage();
  expect(screen.getByRole('heading', { name: t('en', 'leaveHistory.reportTitle') })).toBeTruthy();
});

it('opens the period on the first of January and on today in the branch time zone', () => {
  renderPage();
  expect((screen.getByLabelText(t('en', 'leave.from')) as HTMLInputElement).value).toBe(
    '2026-01-01',
  );
  expect((screen.getByLabelText(t('en', 'leave.to')) as HTMLInputElement).value).toBe('2026-10-25');
});

it('shows the employee with the number, the branch name and the period of every row', async () => {
  routeGets({ history: () => ({ data: historyPage({ items: [historyLeaveRow()] }) }) });
  renderPage();
  await screen.findByText('Synthetic employee #1');
  expect(rows().getByText('Synthetic branch')).toBeTruthy();
  expect(rows().queryByText(leaveId)).toBeNull();
  expect(rows().getByText(new RegExp(day('2027-01-01')))).toBeTruthy();
});

it('labels an unexcused absence and a shift covered in another branch', async () => {
  routeGets({ history: () => ({ data: historyPage({ items: [absenceRow(), coveredRow()] }) }) });
  renderPage();
  await screen.findByText(t('en', 'leaveHistory.coveredElsewhere'));
  expect(rows().getByText(t('en', 'leaveHistory.absenceType'))).toBeTruthy();
  expect(rows().getByText(t('en', 'leaveHistory.coveredElsewhere'))).toBeTruthy();
});

it('shows no action buttons on the report rows', async () => {
  routeGets({
    history: () => ({
      data: historyPage({
        items: [historyLeaveRow({ can_cancel: true, can_decide: true, can_revoke: true })],
      }),
    }),
  });
  renderPage();
  await screen.findByText('Synthetic employee #1');
  const actions = ['leave.cancel', 'leave.approve', 'leave.reject', 'leave.revoke'] as const;
  for (const key of actions) {
    expect(screen.queryByRole('button', { name: t('en', key) })).toBeNull();
  }
  expect(screen.queryByRole('columnheader', { name: t('en', 'leave.decision') })).toBeNull();
});

it('reads the chosen employee and shows the last taken line', async () => {
  routeGets({
    history: () => ({
      data: historyPage({
        items: [historyLeaveRow()],
        last_taken: {
          annual: { from: '2026-01-05', to: '2026-01-09' },
          sick: null,
          unpaid: null,
        },
      }),
    }),
  });
  renderPage();
  await screen.findByText('Synthetic employee #1');
  expect(screen.queryByText(new RegExp(t('en', 'leaveHistory.lastAnnual')))).toBeNull();
  fireEvent.change(screen.getByLabelText(t('en', 'leaveHistory.reportSearchEmployee')), {
    target: { value: 'Syn' },
  });
  const select = screen.getByLabelText(t('en', 'leaveHistory.reportEmployee'));
  await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(2));
  fireEvent.change(select, { target: { value: leaveId } });
  await waitFor(() =>
    expect(queries('/leave-history').at(-1)).toMatchObject({ employee_id: leaveId }),
  );
  const range = `${day('2026-01-05')} – ${day('2026-01-09')}`;
  const annual = `${t('en', 'leaveHistory.lastAnnual')}: ${range}`;
  const sick = new RegExp(`${t('en', 'leaveHistory.lastSick')}: ${t('en', 'leaveHistory.none')}$`);
  const line = await screen.findByText(
    (_, node) => node?.tagName === 'P' && node.textContent?.includes(annual) === true,
  );
  expect(line.textContent).toContain(annual);
  expect(await screen.findByText(sick)).toBeTruthy();
});

it('sends the type filter and shows only the matching rows', async () => {
  routeGets({
    history: (query) => {
      const filtered = query['types[]'] !== undefined;
      return {
        data: historyPage({
          items: [
            historyLeaveRow({
              type: filtered ? 'ANNUAL' : 'SICK',
              note: filtered ? 'Synthetic filtered annual' : 'Synthetic unfiltered sick',
            }),
          ],
        }),
      };
    },
  });
  renderPage();
  await screen.findByText('Synthetic unfiltered sick');
  fireEvent.change(screen.getByRole('combobox', { name: t('en', 'leave.type') }), {
    target: { value: 'ANNUAL' },
  });
  applyFilters();
  await screen.findByText('Synthetic filtered annual');
  expect(screen.queryByText('Synthetic unfiltered sick')).toBeNull();
  expect(queries('/leave-history').at(-1)).toMatchObject({ 'types[]': ['ANNUAL'] });
});

it('refuses a period that ends before it starts and sends no read', async () => {
  routeGets({ history: () => ({ data: historyPage({ items: [historyLeaveRow()] }) }) });
  renderPage();
  await screen.findByText('Synthetic employee #1');
  const count = queries('/leave-history').length;
  fireEvent.change(screen.getByLabelText(t('en', 'leave.from')), {
    target: { value: '2026-11-01' },
  });
  applyFilters();
  expect((await screen.findByRole('alert')).textContent).toBe(t('en', 'leaveHistory.rangeInvalid'));
  expect(queries('/leave-history')).toHaveLength(count);
});

it('shows the envelope message when the chosen employee is refused and keeps the filters', async () => {
  routeGets({ history: () => envelopeFailure(404, 'NOT_FOUND') });
  renderPage();
  const select = screen.getByLabelText(t('en', 'leaveHistory.reportEmployee'));
  await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(2));
  fireEvent.change(select, { target: { value: leaveId } });
  await waitFor(() =>
    expect(queries('/leave-history').at(-1)).toMatchObject({ employee_id: leaveId }),
  );
  expect((await screen.findByRole('alert')).textContent).toBe(
    envelopeFailure(404, 'NOT_FOUND').error.message_en,
  );
  expect(screen.getByLabelText(t('en', 'leave.from'))).toBeTruthy();
  expect(screen.getByLabelText(t('en', 'leaveHistory.reportEmployee'))).toBeTruthy();
});

it('shows that the employee list is unavailable and still lists the report rows', async () => {
  routeGets({
    history: () => ({ data: historyPage({ items: [historyLeaveRow()] }) }),
    employees: () => envelopeFailure(500, 'INTERNAL_ERROR'),
  });
  renderPage();
  expect(await screen.findByText(t('en', 'leaveHistory.reportEmployeesUnavailable'))).toBeTruthy();
  expect(screen.getByText('Synthetic employee #1')).toBeTruthy();
});

it('shows that the employee list is empty and still lists the report rows', async () => {
  routeGets({
    history: () => ({ data: historyPage({ items: [historyLeaveRow()] }) }),
    employees: () => ({ data: employeesPage([]) }),
  });
  renderPage();
  expect(await screen.findByText(t('en', 'leaveHistory.reportEmployeesUnavailable'))).toBeTruthy();
  expect(screen.getByText('Synthetic employee #1')).toBeTruthy();
});

it('reads the next page when the page carries a cursor', async () => {
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
  renderPage();
  await screen.findByText('Synthetic page one');
  const next = screen.getByRole('button', { name: t('en', 'leave.next') }) as HTMLButtonElement;
  expect(next.disabled).toBe(false);
  fireEvent.click(next);
  await screen.findByText('Synthetic page two');
  expect(queries('/leave-history').at(-1)).toMatchObject({ cursor: 'cursor-2' });
});

it('goes back to the first page when the cursor expired', async () => {
  routeGets({
    history: (query) =>
      query.cursor === undefined
        ? {
            data: historyPage({
              items: [historyLeaveRow({ note: 'Synthetic page one' })],
              next_cursor: 'cursor-2',
            }),
          }
        : expiredCursor,
  });
  renderPage();
  await screen.findByText('Synthetic page one');
  fireEvent.click(screen.getByRole('button', { name: t('en', 'leave.next') }));
  await waitFor(() => expect(queries('/leave-history')).toHaveLength(3));
  const reads = queries('/leave-history');
  expect(reads[1]).toMatchObject({ cursor: 'cursor-2' });
  expect(reads[2]?.cursor).toBeUndefined();
  expect(await screen.findByText('Synthetic page one')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('shows the report in Arabic', async () => {
  state.locale = 'ar';
  routeGets({ history: () => ({ data: historyPage({ items: [historyLeaveRow()] }) }) });
  renderPage();
  expect(screen.getByRole('heading', { name: t('ar', 'leaveHistory.reportTitle') })).toBeTruthy();
  expect(screen.getByLabelText(t('ar', 'leaveHistory.reportEmployee'))).toBeTruthy();
  await screen.findByText('Synthetic employee #1');
  expect(screen.getByRole('button', { name: t('ar', 'leave.next') })).toBeTruthy();
});
