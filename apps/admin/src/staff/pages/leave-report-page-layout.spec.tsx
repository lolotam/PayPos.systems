import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Profiler } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { leaveId } from '../api/leave-decision.fixture';
import { absenceRow, coveredRow, historyLeaveRow, historyPage } from '../api/leave-history.fixture';
import { branches, employeeListItem, employeesPage } from '../api/leave-report.fixture';
import { LeaveReportPage } from './leave-report-page';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const scope = { companyId: leaveId, businessId: leaveId, userId: leaveId };
let client: QueryClient;

function route(history: () => unknown) {
  api.GET.mockImplementation(async (path: string) => {
    if (path.endsWith('/leave-history')) return history();
    return { data: employeesPage([employeeListItem()]) };
  });
}

function renderPage(onRender: () => void = () => undefined) {
  return render(
    <QueryClientProvider client={client}>
      <Profiler id="report" onRender={onRender}>
        <LeaveReportPage scope={scope} branches={branches} />
      </Profiler>
    </QueryClientProvider>,
  );
}

function cardOf(element: HTMLElement) {
  return element.closest('.rounded-card') as HTMLElement;
}

function historyReads() {
  return api.GET.mock.calls.filter((call) => (call[0] as string).endsWith('/leave-history'));
}

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup();
  client.clear();
});

it('puts both filters, the table and the paging in one card, in that order, under the heading', async () => {
  route(() => ({ data: historyPage({ items: [historyLeaveRow()], next_cursor: leaveId }) }));
  renderPage();
  await screen.findByText('Synthetic employee #1');
  const table = screen.getByRole('table');
  const card = cardOf(table);
  const heading = screen.getByRole('heading', { name: t('en', 'leaveHistory.reportTitle') });
  const employee = within(card).getByLabelText(t('en', 'leaveHistory.reportEmployee'));
  const period = within(card).getByLabelText(t('en', 'leave.from'));
  const next = within(card).getByRole('button', { name: t('en', 'leave.next') });
  const follows = (a: Node, b: Node) =>
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING;
  expect(follows(employee, period)).toBeTruthy();
  expect(follows(period, table)).toBeTruthy();
  expect(follows(table, next)).toBeTruthy();
  expect(heading.closest('[data-page-shell="list"]')?.contains(card)).toBe(true);
  expect(card.contains(heading)).toBe(false);
});

it('labels every stacked cell that has content, row by row, naming the details cell by what it holds', async () => {
  route(() => ({
    data: historyPage({
      items: [
        historyLeaveRow(),
        absenceRow({ id: '01920000-0000-7000-8000-000000000a02' }),
        coveredRow({ id: '01920000-0000-7000-8000-000000000a03' }),
      ],
    }),
  }));
  renderPage();
  await screen.findAllByText('Synthetic employee #1');
  const rows = screen.getAllByRole('row');
  // يُقرأ صنف التكديس من نص ثابت هنا: لو أُزيل stacked من الإطار سقط هذا الاختبار.
  expect(screen.getByRole('table').parentElement?.className).toContain(
    'max-[599.99px]:[&_table]:block',
  );
  const labelsOf = (row: HTMLElement | undefined) =>
    within(row as HTMLElement)
      .getAllByRole('cell')
      .map((cell) => cell.getAttribute('data-cell-label'));
  const common = [null, t('en', 'leave.date'), t('en', 'leave.branch'), t('en', 'leave.type')];
  const shift = t('en', 'attendanceStatementScreen.shift');
  expect(labelsOf(rows[1])).toEqual([
    ...common,
    t('en', 'leave.status'),
    t('en', 'leave.decisionReason'),
  ]);
  expect(labelsOf(rows[2])).toEqual([...common, t('en', 'leave.status'), shift]);
  expect(labelsOf(rows[3])).toEqual([...common, null, shift]);
});

it('sends one history read on first mount', async () => {
  route(() => ({ data: historyPage({ items: [historyLeaveRow()], next_cursor: leaveId }) }));
  renderPage();
  await screen.findByText('Synthetic employee #1');
  expect(historyReads()).toHaveLength(1);
});

it.each([500, 403])(
  'keeps the filter mounted and focused when a read is refused with %i, with no employee data beside the refusal and only the way back',
  async (status) => {
    route(() => ({ data: historyPage({ items: [historyLeaveRow()], next_cursor: leaveId }) }));
    const seen: number[] = [];
    renderPage(() => seen.push(screen.queryAllByText(/Synthetic employee #\d/).length));
    await screen.findByText('Synthetic employee #1');
    const from = screen.getByLabelText(t('en', 'leave.from'));
    from.focus();
    route(() => ({
      error: { code: 'REFUSED', message_ar: 'Synthetic refusal', message_en: 'Synthetic refusal' },
      response: { status },
    }));
    seen.length = 0;
    fireEvent.change(from, { target: { value: '2026-02-01' } });
    fireEvent.click(screen.getByRole('button', { name: t('en', 'leave.applyFilters') }));
    const alert = await screen.findByRole('alert');
    expect(cardOf(alert)).toBe(cardOf(from));
    expect(screen.getByLabelText(t('en', 'leave.from'))).toBe(from);
    expect(document.activeElement).toBe(from);
    expect(seen.every((count) => count === 0)).toBe(true);
    const next = within(cardOf(alert)).getByRole('button', { name: t('en', 'leave.next') });
    expect((next as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('table')).toBeNull();
  },
);
