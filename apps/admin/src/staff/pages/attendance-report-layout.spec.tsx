import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { boardBranches } from '../api/attendance-board.fixture';
import { reportFixture, reportScope } from '../api/attendance-report.fixture';
import { AttendanceReportPage } from './attendance-report-page';
import { cardOf, cellLabels, follows, headerTexts } from './stacked-layout.helpers';

const api = vi.hoisted(() => ({ GET: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

let client: QueryClient;

function renderPage() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AttendanceReportPage
        scope={reportScope}
        branches={boardBranches}
        allowAllBranches
        timezone="Asia/Kuwait"
        onBranch={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

function downloadButton() {
  return screen.getByRole('button', { name: /download csv|downloading csv/i }) as HTMLButtonElement;
}

function employeeNames() {
  return screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[1]?.textContent);
}

function sortControl() {
  return screen.getByLabelText(t('en', 'attendanceReport.sortBy')) as HTMLSelectElement;
}

beforeEach(() => {
  api.GET.mockReset();
  api.GET.mockResolvedValue({ data: reportFixture });
});
afterEach(() => {
  cleanup();
  client.clear();
});

it('puts the filters, the hours note and the table in one card under the heading, with Download in the header', async () => {
  renderPage();
  const table = await screen.findByRole('table');
  const card = cardOf(table);
  const heading = screen.getByRole('heading', { name: t('en', 'attendanceReport.title') });
  const month = within(card).getByLabelText(t('en', 'attendanceReport.month'));
  const branch = within(card).getByLabelText(t('en', 'attendanceReport.branch'));
  const note = within(card).getByText(t('en', 'attendanceReport.hoursFormat'));
  const inOrder = [month, branch, note, table];
  expect(
    inOrder.every((node, index) => index === 0 || follows(inOrder[index - 1] as Node, node)),
  ).toBe(true);
  expect(heading.closest('[data-page-shell="list"]')?.contains(card)).toBe(true);
  expect(card.contains(heading)).toBe(false);
  expect(card.contains(downloadButton())).toBe(false);
  expect(heading.closest('header')?.contains(downloadButton())).toBe(true);
});

it('labels every stacked cell of a row with its column header, except the first', async () => {
  renderPage();
  const table = await screen.findByRole('table');
  // يُقرأ صنف التكديس من نص ثابت هنا: لو أُزيل stacked من الإطار سقط هذا الاختبار.
  expect(table.parentElement?.className).toContain('max-[599.99px]:[&_table]:block');
  const headers = headerTexts(table);
  const labels = cellLabels(screen.getAllByRole('row')[1] as HTMLElement);
  expect(labels).toEqual(headers.map((header, index) => (index === 0 ? null : header)));
  expect(headers.length).toBeGreaterThan(8);
});

it('gives no label to the leave cell of a row with no leave, and keeps the cell in the row', async () => {
  renderPage();
  const table = await screen.findByRole('table');
  const headers = headerTexts(table);
  const row = screen.getAllByRole('row')[2] as HTMLElement;
  const leave = headers.indexOf(t('en', 'attendanceReport.leave'));
  expect(cellLabels(row)).toEqual(
    headers.map((header, index) => (index === 0 || index === leave ? null : header)),
  );
  const cell = within(row).getAllByRole('cell')[leave] as HTMLElement;
  expect(within(row).getAllByRole('cell')).toHaveLength(headers.length);
  expect(cell.childElementCount).toBe(0);
  expect(cell.className).toContain('max-[599.99px]:empty:py-0');
});

it('offers the same sorting as a control for the stacked layout, on the same state as the header buttons', async () => {
  renderPage();
  const table = await screen.findByRole('table');
  expect(sortControl().closest('div')?.className).toContain('max-[599.99px]:grid');
  expect(sortControl().closest('div')?.className.split(' ')).toContain('hidden');
  expect(sortControl().value).toBe('');
  const sortable = within(table)
    .getAllByRole('columnheader')
    .filter((h) => h.querySelector('button'));
  expect(Array.from(sortControl().options).length).toBe(1 + sortable.length * 2);
  fireEvent.change(sortControl(), { target: { value: 'days_present:desc' } });
  expect(employeeNames()).toEqual(['Other synthetic employee', 'Synthetic employee']);
  const worked = sortable.find((h) => h.textContent === t('en', 'attendanceReport.workedHours'));
  fireEvent.click(within(worked as HTMLElement).getByRole('button'));
  expect(sortControl().value).toBe('worked_minutes:asc');
  expect(employeeNames()).toEqual(['Synthetic employee', 'Other synthetic employee']);
  fireEvent.change(sortControl(), { target: { value: 'worked_minutes:desc' } });
  expect(employeeNames()).toEqual(['Other synthetic employee', 'Synthetic employee']);
  fireEvent.change(sortControl(), { target: { value: '' } });
  expect(employeeNames()).toEqual(['Synthetic employee', 'Other synthetic employee']);
});

it('disables Download until the report shows and while a download runs, and shows a failed download in the card', async () => {
  let finish: (value: unknown) => void = () => undefined;
  api.GET.mockImplementation(async (path: string) => {
    if (!path.endsWith('.csv')) return { data: reportFixture };
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  renderPage();
  expect(downloadButton().disabled).toBe(true);
  await screen.findByRole('table');
  expect(downloadButton().disabled).toBe(false);
  fireEvent.click(downloadButton());
  const month = screen.getByLabelText(t('en', 'attendanceReport.month'));
  const status = await screen.findByRole('status');
  expect(status.textContent).toBe(t('en', 'attendanceReport.downloading'));
  expect(cardOf(status)).toBe(cardOf(month));
  expect(downloadButton().disabled).toBe(true);
  finish({ error: { code: 'INTERNAL' }, response: { status: 500 } });
  const alert = await screen.findByRole('alert');
  expect(cardOf(alert)).toBe(cardOf(month));
  expect(downloadButton().disabled).toBe(false);
  expect(screen.queryByRole('status')).toBeNull();
});

it('reads once on first mount and keeps the month input and its focus when the read is refused', async () => {
  renderPage();
  await screen.findByRole('table');
  expect(api.GET).toHaveBeenCalledTimes(1);
  const month = screen.getByLabelText(t('en', 'attendanceReport.month'));
  month.focus();
  api.GET.mockResolvedValue({ error: { code: 'FORBIDDEN' }, response: { status: 403 } });
  fireEvent.change(month, { target: { value: '2026-09' } });
  const alert = await screen.findByRole('alert');
  expect(screen.getByLabelText(t('en', 'attendanceReport.month'))).toBe(month);
  expect(document.activeElement).toBe(month);
  expect(cardOf(alert)).toBe(cardOf(month));
  expect(screen.queryByRole('table')).toBeNull();
  expect(downloadButton().disabled).toBe(true);
  expect(api.GET).toHaveBeenCalledTimes(2);
});
