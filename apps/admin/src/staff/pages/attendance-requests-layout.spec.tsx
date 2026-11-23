import { t } from '@pospay/i18n';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { attendanceTestClient, boardScope, requestPage } from '../api/attendance-actions.fixture';
import { boardBranches } from '../api/attendance-board.fixture';
import { AttendanceRequestsPage } from './attendance-requests-page';
import { cardOf, cellLabels, follows, headerTexts } from './stacked-layout.helpers';

const api = vi.hoisted(() => ({ GET: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const refusal = { error: { code: 'FORBIDDEN' }, response: { status: 403 } };
let listAnswer: () => unknown;

function route(canRequest: boolean) {
  api.GET.mockImplementation(async (path: string, options: { params: { query: unknown } }) => {
    if (path.endsWith('attendance-capabilities')) {
      return { data: { correct: false, resolve: false, request_change: true, decide: true } };
    }
    const query = options.params.query as { limit: number };
    if (query.limit === 1) return { data: { ...requestPage, can_request: canRequest, items: [] } };
    return listAnswer();
  });
}

function listReads() {
  return api.GET.mock.calls.filter(
    ([path, options]) =>
      path.endsWith('attendance-change-requests') && options.params.query.limit !== 1,
  );
}

function renderPage(branches = boardBranches) {
  const test = attendanceTestClient();
  const view = render(
    <AttendanceRequestsPage scope={boardScope} branches={branches} onBranch={vi.fn()} />,
    { wrapper: test.wrapper },
  );
  return { ...view, client: test.client };
}

beforeEach(() => {
  api.GET.mockReset();
  listAnswer = () => ({ data: requestPage });
});
afterEach(cleanup);

it('puts the filters, the table and the paging in one card under the heading, with the manual action in the header', async () => {
  route(true);
  renderPage();
  const table = await screen.findByRole('table');
  const card = cardOf(table);
  const heading = screen.getByRole('heading', { name: t('en', 'attendanceActions.requests') });
  const branch = within(card).getByLabelText(t('en', 'attendanceBoard.branch'));
  const status = within(card).getByLabelText(t('en', 'attendanceBoard.status'));
  const more = within(card).getByRole('button', { name: t('en', 'attendanceBoard.loadMore') });
  expect(follows(branch, status) && follows(status, table) && follows(table, more)).toBe(true);
  const manual = await screen.findByRole('button', { name: t('en', 'attendanceActions.manual') });
  expect(card.contains(manual)).toBe(false);
  expect(heading.closest('header')?.contains(manual)).toBe(true);
  expect(heading.closest('[data-page-shell="list"]')?.contains(card)).toBe(true);
});

it('labels every stacked cell that has content with its column header, and not the action cell', async () => {
  route(false);
  renderPage();
  const table = await screen.findByRole('table');
  // يُقرأ صنف التكديس من نص ثابت هنا: لو أُزيل stacked من الإطار سقط هذا الاختبار.
  expect(screen.getByRole('table').parentElement?.className).toContain(
    'max-[599.99px]:[&_table]:block',
  );
  const headers = headerTexts(table);
  const labels = cellLabels(screen.getAllByRole('row')[1] as HTMLElement);
  expect(labels).toHaveLength(headers.length);
  const last = headers.length - 1;
  const expected = headers.map((header, index) =>
    index === 0 || index === last || index === last - 1 ? null : header,
  );
  expect(labels).toEqual(expected);
  const actions = within(screen.getAllByRole('row')[1] as HTMLElement).getAllByRole('cell')[last];
  expect(
    within(actions as HTMLElement).getByRole('button', {
      name: t('en', 'attendanceActions.approve'),
    }),
  ).toBeTruthy();
});

it('collapses the action cell of a row with no action and gives it no label', async () => {
  const [item] = requestPage.items;
  listAnswer = () => ({
    data: { ...requestPage, items: [{ ...item, can_decide: false, can_cancel: false }] },
  });
  route(false);
  renderPage();
  const row = (await screen.findAllByRole('row'))[1] as HTMLElement;
  const cells = within(row).getAllByRole('cell');
  const actions = cells[cells.length - 1] as HTMLElement;
  expect(actions.childElementCount).toBe(0);
  expect(actions.hasAttribute('data-cell-label')).toBe(false);
  expect(actions.className).toContain('max-[599.99px]:empty:py-0');
  expect(cells).toHaveLength(headerTexts(screen.getByRole('table')).length);
});

it('reads the access once and the list once, and keeps the filters and their focus when the list is refused', async () => {
  route(false);
  renderPage();
  await screen.findByRole('table');
  expect(listReads()).toHaveLength(1);
  const status = screen.getByLabelText(t('en', 'attendanceBoard.status'));
  status.focus();
  listAnswer = () => refusal;
  fireEvent.change(status, { target: { value: 'APPROVED' } });
  await screen.findByRole('alert');
  expect(screen.getByLabelText(t('en', 'attendanceBoard.status'))).toBe(status);
  expect(document.activeElement).toBe(status);
  expect(cardOf(screen.getByRole('alert'))).toBe(cardOf(status));
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.queryByRole('button', { name: t('en', 'attendanceBoard.loadMore') })).toBeNull();
  expect(listReads()).toHaveLength(2);
});

it('makes no list read, and keeps the card with its filters, while the branch has no time zone', async () => {
  route(true);
  const noZone = boardBranches.map((branch) => ({ ...branch, effective_timezone: '' }));
  renderPage(noZone);
  await screen.findByLabelText(t('en', 'attendanceBoard.branch'));
  expect(listReads()).toHaveLength(0);
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.queryByRole('button', { name: t('en', 'attendanceActions.manual') })).toBeNull();
});
