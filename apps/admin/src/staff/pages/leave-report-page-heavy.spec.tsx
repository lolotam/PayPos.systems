import { errorMessages, t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { leaveId } from '../api/leave-decision.fixture';
import { historyLeaveRow, historyPage } from '../api/leave-history.fixture';
import {
  branches,
  employeeListItem,
  employeesPage,
  envelopeFailure,
  failedReport,
  nextReportId,
  pendingReport,
  readyReport,
  reportBranchId,
  reportId,
  requiredRefusal,
} from '../api/leave-report.fixture';
import { LeaveReportPage } from './leave-report-page';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

type GetOptions = { params: { query: Record<string, unknown> } };
type GetResult =
  | { data: unknown }
  | {
      error: { code: string; message_ar: string; message_en: string };
      response: { status: number };
    };

const scope = { companyId: leaveId, businessId: leaveId, userId: leaveId };
let client: QueryClient;
let reportResult: GetResult;
let posted: number;
let syncReadsFresh: boolean;

function routeGets() {
  api.GET.mockImplementation(async (path: string, options: GetOptions) => {
    if (path.includes('/leave-history/reports/')) return reportResult;
    if (path.endsWith('/leave-history')) {
      if (syncReadsFresh) {
        return {
          data: historyPage({ items: [historyLeaveRow({ note: 'Synthetic fresh sync row' })] }),
        };
      }
      return options.params.query['employee_id'] === undefined
        ? requiredRefusal()
        : { data: historyPage({ items: [historyLeaveRow({ note: 'Synthetic employee row' })] }) };
    }
    if (path.endsWith('/employees')) return { data: employeesPage([employeeListItem()]) };
    throw new Error(`Unexpected GET ${path}`);
  });
  api.POST.mockImplementation(async () => {
    const accepted = { report_id: posted === 0 ? reportId : nextReportId };
    posted += 1;
    return { data: accepted };
  });
}

function reportGets() {
  return api.GET.mock.calls.filter((call) =>
    (call[0] as string).includes('/leave-history/reports/'),
  );
}

function syncGets() {
  return api.GET.mock.calls.filter((call) => (call[0] as string).endsWith('/leave-history'));
}

function postBody(index: number) {
  const call = api.POST.mock.calls[index];
  return (call?.[1] as { body: unknown } | undefined)?.body;
}

function readyWith(note: string): GetResult {
  return { data: readyReport({ items: [historyLeaveRow({ note })] }) };
}

async function flush(times = 8) {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
  }
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

function renderPage() {
  return render(
    <QueryClientProvider client={client}>
      <LeaveReportPage scope={scope} branches={branches} />
    </QueryClientProvider>,
  );
}

function applyFilters() {
  fireEvent.click(screen.getByRole('button', { name: t('en', 'leave.applyFilters') }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({
    toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
  });
  vi.setSystemTime(new Date('2026-10-24T22:30:00Z'));
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  reportResult = { data: pendingReport() };
  posted = 0;
  syncReadsFresh = false;
  routeGets();
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.useRealTimers();
});

it('asks for the heavy report once with the period and the filters only', async () => {
  renderPage();
  await flush();
  expect(api.POST).toHaveBeenCalledTimes(1);
  expect(postBody(0)).toEqual({
    from: '2026-01-01',
    to: '2026-10-25',
    'types[]': [],
    'statuses[]': [],
  });
  expect(screen.getByText(t('en', 'leaveHistory.reportPreparing'))).toBeTruthy();
});

it('keeps one report request when the screen is closed and opened again', async () => {
  const first = renderPage();
  await flush();
  expect(api.POST).toHaveBeenCalledTimes(1);
  expect(screen.getByText(t('en', 'leaveHistory.reportPreparing'))).toBeTruthy();
  first.unmount();
  renderPage();
  await flush();
  expect(api.POST).toHaveBeenCalledTimes(1);
  expect(screen.getByText(t('en', 'leaveHistory.reportPreparing'))).toBeTruthy();
  reportResult = readyWith('Synthetic stored row');
  await advance(3000);
  expect(screen.getByText('Synthetic stored row')).toBeTruthy();
  expect(api.POST).toHaveBeenCalledTimes(1);
});

it('shows the fresh sync rows instead of the stored report after a reopen', async () => {
  reportResult = readyWith('Synthetic old stored report');
  const first = renderPage();
  await flush();
  expect(api.POST).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Synthetic old stored report')).toBeTruthy();
  first.unmount();
  syncReadsFresh = true;
  renderPage();
  await flush();
  expect(screen.getByText('Synthetic fresh sync row')).toBeTruthy();
  expect(screen.queryByText('Synthetic old stored report')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(reportGets()).toHaveLength(1);
  expect(api.POST).toHaveBeenCalledTimes(1);
});

it('asks for a new report when the filters are applied again after reopening', async () => {
  const first = renderPage();
  await flush();
  expect(api.POST).toHaveBeenCalledTimes(1);
  expect(screen.getByText(t('en', 'leaveHistory.reportPreparing'))).toBeTruthy();
  first.unmount();
  renderPage();
  await flush();
  expect(api.POST).toHaveBeenCalledTimes(1);
  expect(screen.getByText(t('en', 'leaveHistory.reportPreparing'))).toBeTruthy();
  reportResult = readyWith('Synthetic second report');
  applyFilters();
  await flush();
  expect(api.POST).toHaveBeenCalledTimes(2);
  expect(screen.getByText('Synthetic second report')).toBeTruthy();
});

it('never reuses the request of an older run when the screen is reopened', async () => {
  reportResult = readyWith('Synthetic older run row');
  const first = renderPage();
  await flush();
  expect(api.POST).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Synthetic older run row')).toBeTruthy();
  fireEvent.change(screen.getByLabelText(t('en', 'leave.from')), {
    target: { value: '2026-02-01' },
  });
  applyFilters();
  await flush();
  expect(api.POST).toHaveBeenCalledTimes(2);
  first.unmount();
  renderPage();
  await flush();
  expect(api.POST).toHaveBeenCalledTimes(2);
  fireEvent.change(screen.getByLabelText(t('en', 'leave.from')), {
    target: { value: '2026-02-01' },
  });
  reportResult = readyWith('Synthetic final run row');
  applyFilters();
  await flush();
  expect(api.POST).toHaveBeenCalledTimes(3);
  expect(screen.getByText('Synthetic final run row')).toBeTruthy();
  expect(screen.queryByText('Synthetic older run row')).toBeNull();
});

it('shows the preparing text while the report runs and the rows when it is ready', async () => {
  renderPage();
  await flush();
  expect(screen.getByText(t('en', 'leaveHistory.reportPreparing'))).toBeTruthy();
  reportResult = readyWith('Synthetic stored row');
  await advance(3000);
  expect(screen.queryByText(t('en', 'leaveHistory.reportPreparing'))).toBeNull();
  expect(screen.getByText('Synthetic stored row')).toBeTruthy();
});

it('polls the report every three seconds only while it is pending', async () => {
  renderPage();
  await flush();
  expect(screen.getByText(t('en', 'leaveHistory.reportPreparing'))).toBeTruthy();
  expect(reportGets()).toHaveLength(1);
  await advance(3000);
  expect(reportGets()).toHaveLength(2);
  await advance(3000);
  expect(reportGets()).toHaveLength(3);
  reportResult = { data: readyReport() };
  await advance(3000);
  expect(reportGets()).toHaveLength(4);
  expect(screen.queryByText(t('en', 'leaveHistory.reportPreparing'))).toBeNull();
  await advance(9000);
  expect(reportGets()).toHaveLength(4);
});

it('never posts again and stops reading once the report is ready', async () => {
  renderPage();
  await flush();
  expect(screen.getByText(t('en', 'leaveHistory.reportPreparing'))).toBeTruthy();
  reportResult = { data: readyReport({ items: [historyLeaveRow()] }) };
  await advance(3000);
  expect(screen.queryByText(t('en', 'leaveHistory.reportPreparing'))).toBeNull();
  expect(screen.getByText('Synthetic past annual')).toBeTruthy();
  const count = reportGets().length;
  await advance(10_000);
  expect(reportGets()).toHaveLength(count);
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await advance(1000);
  expect(reportGets()).toHaveLength(count);
  expect(api.POST).toHaveBeenCalledTimes(1);
});

it('shows the stored failure of the report and stops polling', async () => {
  reportResult = { data: failedReport('LEAVE_HISTORY_REPORT_FAILED') };
  renderPage();
  await flush();
  expect(screen.getByRole('alert').textContent).toBe(
    errorMessages('LEAVE_HISTORY_REPORT_FAILED').message_en,
  );
  const count = reportGets().length;
  await advance(9000);
  expect(reportGets()).toHaveLength(count);
});

it('shows the busy refusal and never asks for a second report', async () => {
  api.POST.mockResolvedValue(envelopeFailure(409, 'LEAVE_HISTORY_REPORT_BUSY'));
  renderPage();
  await flush();
  expect(screen.getByRole('alert').textContent).toBe(
    errorMessages('LEAVE_HISTORY_REPORT_BUSY').message_en,
  );
  await advance(10_000);
  expect(api.POST).toHaveBeenCalledTimes(1);
});

it('shows the alert when the report result read fails', async () => {
  reportResult = envelopeFailure(404, 'LEAVE_HISTORY_REPORT_NOT_FOUND');
  renderPage();
  await flush();
  expect(screen.getByRole('alert').textContent).toBe(
    errorMessages('LEAVE_HISTORY_REPORT_NOT_FOUND').message_en,
  );
});

it('keeps the next page enabled on an empty report page and reads it with the cursor', async () => {
  reportResult = { data: readyReport({ items: [], next_cursor: 'c2' }) };
  renderPage();
  await flush();
  expect(screen.queryByText(t('en', 'leaveHistory.historyEmpty'))).toBeNull();
  const next = screen.getByRole('button', { name: t('en', 'leave.next') }) as HTMLButtonElement;
  expect(next.disabled).toBe(false);
  fireEvent.click(next);
  await flush(2);
  const last = reportGets().at(-1)?.[1] as { params: { query: Record<string, unknown> } };
  expect(last.params.query).toMatchObject({ cursor: 'c2' });
});

it('shows the empty message on a report page without a cursor', async () => {
  reportResult = { data: readyReport({ items: [], next_cursor: null }) };
  renderPage();
  await flush();
  expect(screen.getByText(t('en', 'leaveHistory.historyEmpty'))).toBeTruthy();
});

it('starts a new report run when the filters are applied again', async () => {
  reportResult = readyWith('Synthetic first run');
  renderPage();
  await flush();
  expect(screen.getByText('Synthetic first run')).toBeTruthy();
  reportResult = { data: pendingReport() };
  fireEvent.change(screen.getByLabelText(t('en', 'leave.from')), {
    target: { value: '2026-02-01' },
  });
  applyFilters();
  await flush();
  expect(api.POST).toHaveBeenCalledTimes(2);
  expect(syncGets()).toHaveLength(2);
  expect(screen.queryByText('Synthetic first run')).toBeNull();
  expect(screen.getByText(t('en', 'leaveHistory.reportPreparing'))).toBeTruthy();
});

it('sends the chosen branch in the body of the new report run', async () => {
  renderPage();
  await flush();
  fireEvent.change(screen.getByRole('combobox', { name: t('en', 'leave.branch') }), {
    target: { value: reportBranchId },
  });
  applyFilters();
  await flush();
  expect(api.POST).toHaveBeenCalledTimes(2);
  expect(postBody(1)).toEqual({
    from: '2026-01-01',
    to: '2026-10-25',
    'types[]': [],
    'statuses[]': [],
    branch_id: reportBranchId,
  });
  expect(screen.getByText(t('en', 'leaveHistory.reportPreparing'))).toBeTruthy();
});

it('reads the chosen employee from the fast path after a heavy run', async () => {
  reportResult = readyWith('Synthetic stored row');
  renderPage();
  await flush();
  expect(screen.getByText('Synthetic stored row')).toBeTruthy();
  const select = screen.getByLabelText(t('en', 'leaveHistory.reportEmployee'));
  expect(within(select).getAllByRole('option')).toHaveLength(2);
  fireEvent.change(select, { target: { value: leaveId } });
  await flush();
  expect(api.POST).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Synthetic employee row')).toBeTruthy();
});
