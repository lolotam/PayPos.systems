import { t } from '@pospay/i18n';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { attendanceTestClient, boardScope, exceptionPage } from '../api/attendance-actions.fixture';
import { boardBranches } from '../api/attendance-board.fixture';
import { AttendanceExceptionsPage } from './attendance-exceptions-page';
import { cardOf, cellLabels, follows, headerTexts } from './stacked-layout.helpers';

const api = vi.hoisted(() => ({ GET: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

function renderPage() {
  const test = attendanceTestClient();
  return render(
    <AttendanceExceptionsPage scope={boardScope} branches={boardBranches} onBranch={vi.fn()} />,
    { wrapper: test.wrapper },
  );
}

beforeEach(() => {
  api.GET.mockReset();
  api.GET.mockResolvedValue({ data: exceptionPage });
});
afterEach(cleanup);

it('puts the branch picker, the status tabs, the table and the paging in one card, in that order', async () => {
  renderPage();
  const table = await screen.findByRole('table');
  const card = cardOf(table);
  const heading = screen.getByRole('heading', { name: t('en', 'attendanceActions.exceptions') });
  const branch = within(card).getByLabelText(t('en', 'attendanceBoard.branch'));
  const tabs = within(card).getByRole('group', { name: t('en', 'attendanceBoard.status') });
  const more = within(card).getByRole('button', { name: t('en', 'attendanceBoard.loadMore') });
  expect(follows(branch, tabs) && follows(tabs, table) && follows(table, more)).toBe(true);
  expect(heading.closest('[data-page-shell="list"]')?.contains(card)).toBe(true);
  expect(card.contains(heading)).toBe(false);
});

it('labels every stacked cell that has content with its column header, and not the action cell', async () => {
  renderPage();
  const table = await screen.findByRole('table');
  // يُقرأ صنف التكديس من نص ثابت هنا: لو أُزيل stacked من الإطار سقط هذا الاختبار.
  expect(screen.getByRole('table').parentElement?.className).toContain(
    'max-[599.99px]:[&_table]:block',
  );
  const headers = headerTexts(table);
  const row = screen.getAllByRole('row')[1] as HTMLElement;
  const last = headers.length - 1;
  // السبب فارغ في البيانات، فخليته بلا تسمية؛ والإجراء زر وحده.
  const expected = headers.map((header, index) =>
    index === 0 || index >= last - 1 ? null : header,
  );
  expect(cellLabels(row)).toEqual(expected);
  const actions = within(row).getAllByRole('cell')[last] as HTMLElement;
  expect(
    within(actions).getByRole('button', { name: t('en', 'attendanceActions.resolve') }),
  ).toBeTruthy();
});

it('reads once on first mount and keeps the tabs and their focus when a read is refused, with no paging beside the refusal', async () => {
  renderPage();
  await screen.findByRole('table');
  expect(api.GET).toHaveBeenCalledTimes(1);
  const resolved = screen.getByRole('button', { name: t('en', 'attendanceActions.RESOLVED') });
  resolved.focus();
  api.GET.mockResolvedValue({ error: { code: 'FORBIDDEN' }, response: { status: 403 } });
  fireEvent.click(resolved);
  const alert = await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: t('en', 'attendanceActions.RESOLVED') })).toBe(
    resolved,
  );
  expect(document.activeElement).toBe(resolved);
  expect(cardOf(alert)).toBe(cardOf(resolved));
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.queryByRole('button', { name: t('en', 'attendanceBoard.loadMore') })).toBeNull();
  expect(api.GET).toHaveBeenCalledTimes(2);
});
