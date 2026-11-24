import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
  Reflect.deleteProperty(window, 'matchMedia');
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
  const month = screen.getByLabelText(t('en', 'attendanceReport.month')) as HTMLInputElement;
  month.focus();
  api.GET.mockResolvedValue({ error: { code: 'FORBIDDEN' }, response: { status: 403 } });
  fireEvent.change(month, { target: { value: anotherMonth(month.value) } });
  const alert = await screen.findByRole('alert');
  expect(screen.getByLabelText(t('en', 'attendanceReport.month'))).toBe(month);
  expect(document.activeElement).toBe(month);
  expect(cardOf(alert)).toBe(cardOf(month));
  expect(screen.queryByRole('table')).toBeNull();
  expect(downloadButton().disabled).toBe(true);
  expect(api.GET).toHaveBeenCalledTimes(2);
});

const SOURCE_ORDER = ['Synthetic employee', 'Other synthetic employee'];

// الصفحة تبدأ بالشهر الحالي: نختار شهرًا غيره أيًّا كان تاريخ التشغيل.
function anotherMonth(current: string) {
  return current === '2026-09' ? '2026-08' : '2026-09';
}

async function sortedByDaysDescending() {
  renderPage();
  await screen.findByRole('table');
  fireEvent.change(sortControl(), { target: { value: 'days_present:desc' } });
  expect(employeeNames()).toEqual(['Other synthetic employee', 'Synthetic employee']);
}

it('starts in source order when a sorted month is left for another month and opened again', async () => {
  await sortedByDaysDescending();
  const month = screen.getByLabelText(t('en', 'attendanceReport.month')) as HTMLInputElement;
  const first = month.value;
  fireEvent.change(month, { target: { value: anotherMonth(first) } });
  await screen.findByRole('table');
  fireEvent.change(month, { target: { value: first } });
  await screen.findByRole('table');
  expect(sortControl().value).toBe('');
  expect(employeeNames()).toEqual(SOURCE_ORDER);
});

it('starts in source order when a refusal hides a sorted table and a retry succeeds', async () => {
  await sortedByDaysDescending();
  api.GET.mockResolvedValue({ error: { code: 'FORBIDDEN' }, response: { status: 403 } });
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['attendance-report'] });
  });
  await screen.findByRole('alert');
  expect(screen.queryByRole('table')).toBeNull();
  api.GET.mockResolvedValue({ data: reportFixture });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'attendanceReport.retry') }));
  await screen.findByRole('table');
  expect(sortControl().value).toBe('');
  expect(employeeNames()).toEqual(SOURCE_ORDER);
});

// يحاكي المتصفح: كل استدعاء لـ matchMedia يعطي كائنًا مستقلًا، والحدث «change» يصل كل كائن بترتيب
// إنشائه، وبين كائن وتاليه تُفرَّغ تحديثات React (فحص المهام الدقيقة بعد كل مستمع).
// الاستعلام نفسه يُقارَن بنص ثابت: خلاف شرط الإطار (أصغر تمامًا من 599.99px) لا يطابق.
function stubStackedWidth(initial: boolean) {
  const created: Set<() => void>[] = [];
  let stacked = initial;
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => {
      const listeners = new Set<() => void>();
      created.push(listeners);
      return {
        get matches() {
          return stacked && query === '(width < 599.99px)';
        },
        addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
        removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
      };
    },
  });
  const change = async (next: boolean) => {
    stacked = next;
    for (const listeners of [...created]) {
      await act(async () => {
        listeners.forEach((listener) => listener());
      });
    }
  };
  return { narrow: () => change(true), widen: () => change(false) };
}

function sortButtons(table: HTMLElement) {
  return within(table)
    .getAllByRole('columnheader')
    .flatMap((header) => Array.from(header.querySelectorAll('button')));
}

it('shows plain column names and no sort button in the header cells at the stacked width, and leaves the select working', async () => {
  stubStackedWidth(true);
  renderPage();
  const table = await screen.findByRole('table');
  expect(within(table).queryAllByRole('button')).toHaveLength(0);
  const names = headerTexts(table);
  expect(names).toContain(t('en', 'attendanceReport.workedHours'));
  expect(names.every((name) => name.trim() !== '')).toBe(true);
  fireEvent.change(sortControl(), { target: { value: 'days_present:desc' } });
  expect(employeeNames()).toEqual(['Other synthetic employee', 'Synthetic employee']);
  expect(sortControl().value).toBe('days_present:desc');
});

it('keeps the header sort buttons, named and sorting, above the stacked width', async () => {
  stubStackedWidth(false);
  renderPage();
  const table = await screen.findByRole('table');
  expect(sortButtons(table).length).toBeGreaterThan(5);
  const worked = within(table).getByRole('button', {
    name: t('en', 'attendanceReport.workedHours'),
  });
  fireEvent.click(worked);
  expect(sortControl().value).toBe('worked_minutes:asc');
});

it('moves the focus to the sort select when a focused header button goes away because the width narrows', async () => {
  const width = stubStackedWidth(false);
  renderPage();
  const table = await screen.findByRole('table');
  const worked = within(table).getByRole('button', {
    name: t('en', 'attendanceReport.workedHours'),
  });
  worked.focus();
  expect(document.activeElement).toBe(worked);
  await width.narrow();
  expect(within(table).queryAllByRole('button')).toHaveLength(0);
  expect(document.activeElement).toBe(sortControl());
});

it('moves the focus from the sort select to the header button of the sorted column when the width widens', async () => {
  const width = stubStackedWidth(true);
  renderPage();
  const table = await screen.findByRole('table');
  fireEvent.change(sortControl(), { target: { value: 'days_present:desc' } });
  sortControl().focus();
  await width.widen();
  const sorted = within(table).getByRole('button', {
    name: t('en', 'attendanceReport.daysPresent'),
  });
  expect(document.activeElement).toBe(sorted);
});

it('lands on the header button of the primary sort column when a secondary sort column comes first in the table', async () => {
  const width = stubStackedWidth(false);
  renderPage();
  const table = await screen.findByRole('table');
  const worked = within(table).getByRole('button', {
    name: t('en', 'attendanceReport.workedHours'),
  });
  const number = within(table).getByRole('button', {
    name: t('en', 'attendanceReport.employeeNumber'),
  });
  expect(follows(number, worked)).toBe(true);
  fireEvent.click(worked);
  fireEvent.click(number, { shiftKey: true });
  await width.narrow();
  expect(sortControl().value).toBe('');
  sortControl().focus();
  await width.widen();
  expect(document.activeElement).toBe(
    within(table).getByRole('button', { name: t('en', 'attendanceReport.workedHours') }),
  );
});

it('replaces a desktop multi-sort with the one sort chosen in the phone select', async () => {
  const width = stubStackedWidth(false);
  renderPage();
  const table = await screen.findByRole('table');
  fireEvent.click(within(table).getByRole('button', { name: t('en', 'attendanceReport.workedHours') }));
  fireEvent.click(
    within(table).getByRole('button', { name: t('en', 'attendanceReport.employeeNumber') }),
    { shiftKey: true },
  );
  await width.narrow();
  expect(sortControl().value).toBe('');
  fireEvent.change(sortControl(), { target: { value: 'days_present:desc' } });
  expect(sortControl().value).toBe('days_present:desc');
  fireEvent.change(sortControl(), { target: { value: '' } });
  expect(sortControl().value).toBe('');
});

it('moves the focus from the sort select to the first header button when the width widens and nothing is sorted', async () => {
  const width = stubStackedWidth(true);
  renderPage();
  const table = await screen.findByRole('table');
  sortControl().focus();
  await width.widen();
  expect(document.activeElement).toBe(sortButtons(table)[0]);
});

it('leaves the focus alone when the width changes while it is on something else', async () => {
  const width = stubStackedWidth(true);
  renderPage();
  const table = await screen.findByRole('table');
  const month = screen.getByLabelText(t('en', 'attendanceReport.month'));
  month.focus();
  await width.widen();
  expect(document.activeElement).toBe(month);
  expect(sortButtons(table).length).toBeGreaterThan(5);
});

it('names the empty sort option with the translated missing-value text', async () => {
  renderPage();
  await screen.findByRole('table');
  expect(sortControl().options[0]?.textContent).toBe(t('en', 'catalogServices.missingValue'));
});

it('disables the sort control for a report with no rows, keeps the chosen sort, and applies it when rows arrive for the same month', async () => {
  await sortedByDaysDescending();
  api.GET.mockResolvedValue({ data: { ...reportFixture, rows: [] } });
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['attendance-report'] });
  });
  await screen.findByText(t('en', 'attendanceReport.empty'));
  expect(sortControl().disabled).toBe(true);
  expect(sortControl().value).toBe('days_present:desc');
  api.GET.mockResolvedValue({ data: reportFixture });
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['attendance-report'] });
  });
  await screen.findByRole('table');
  expect(sortControl().disabled).toBe(false);
  expect(sortControl().value).toBe('days_present:desc');
  expect(employeeNames()).toEqual(['Other synthetic employee', 'Synthetic employee']);
});
