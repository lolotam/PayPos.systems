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

beforeEach(() => {
  api.GET.mockReset();
  api.GET.mockResolvedValue({ data: reportFixture });
});
afterEach(() => {
  cleanup();
  client.clear();
});

it('puts the filters, the download, the hours note and the table in one card under the heading', async () => {
  renderPage();
  const table = await screen.findByRole('table');
  const card = cardOf(table);
  const heading = screen.getByRole('heading', { name: t('en', 'attendanceReport.title') });
  const month = within(card).getByLabelText(t('en', 'attendanceReport.month'));
  const branch = within(card).getByLabelText(t('en', 'attendanceReport.branch'));
  const download = within(card).getByRole('button', { name: t('en', 'attendanceReport.download') });
  const note = within(card).getByText(t('en', 'attendanceReport.hoursFormat'));
  const inOrder = [month, branch, download, note, table];
  expect(
    inOrder.every((node, index) => index === 0 || follows(inOrder[index - 1] as Node, node)),
  ).toBe(true);
  expect(heading.closest('[data-page-shell="list"]')?.contains(card)).toBe(true);
  expect(card.contains(heading)).toBe(false);
});

it('labels every stacked cell of a row with its column header, except the first', async () => {
  renderPage();
  const table = await screen.findByRole('table');
  const headers = headerTexts(table);
  const labels = cellLabels(screen.getAllByRole('row')[1] as HTMLElement);
  expect(labels).toEqual(headers.map((header, index) => (index === 0 ? null : header)));
  expect(headers.length).toBeGreaterThan(8);
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
  expect(api.GET).toHaveBeenCalledTimes(2);
});
