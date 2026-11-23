import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import { Profiler } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  boardBranches,
  boardFixture,
  boardScope,
  refusalFixture,
} from '../api/attendance-board.fixture';
import { AttendanceBoardPage } from './attendance-board-page';
import { cardOf, cellLabels, follows, headerTexts } from './stacked-layout.helpers';

const api = vi.hoisted(() => ({ GET: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const allowed = { correct: true, resolve: true, request_change: true, decide: true };
let client: QueryClient;

function answer(path: string, board: unknown = boardFixture) {
  if (path.endsWith('attendance-capabilities')) return allowed;
  return path.endsWith('refusals') ? refusalFixture : board;
}

function boardAndRefusalReads() {
  return api.GET.mock.calls.filter(
    ([path]) => !(path as string).endsWith('attendance-capabilities'),
  );
}

function renderPage(onRender?: () => void) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (date?: string) => (
    <QueryClientProvider client={client}>
      <Profiler id="board" onRender={onRender ?? (() => undefined)}>
        <AttendanceBoardPage
          scope={boardScope}
          branches={boardBranches}
          date={date}
          onDate={vi.fn()}
          onBranch={vi.fn()}
        />
      </Profiler>
    </QueryClientProvider>
  );
  const view = render(ui());
  return { ...view, changeDate: (date: string) => view.rerender(ui(date)) };
}

beforeEach(() => {
  api.GET.mockReset();
  api.GET.mockImplementation(async (path: string) => ({ data: answer(path) }));
});
afterEach(() => {
  cleanup();
  client.clear();
});

it('orders the page: heading, filters, the in-now and refusal blocks, then the sessions table in its card', async () => {
  renderPage();
  await screen.findByRole('table');
  const heading = screen.getByRole('heading', { name: t('en', 'attendanceBoard.title') });
  const branch = screen.getByLabelText(t('en', 'attendanceBoard.branch'));
  const inNow = screen.getByRole('heading', { name: t('en', 'attendanceBoard.inNow') });
  const refusals = await screen.findByRole('heading', {
    name: t('en', 'attendanceBoard.refusals'),
  });
  const sessions = screen.getByRole('region', { name: t('en', 'attendanceBoard.sessions') });
  const ordered = [heading, branch, inNow, refusals, sessions];
  expect(
    ordered.every((node, index) => index === 0 || follows(ordered[index - 1] as Node, node)),
  ).toBe(true);
  expect(heading.closest('[data-page-shell="list"]')?.contains(sessions)).toBe(true);
});

it('keeps the filters and the status blocks outside any card, and the sessions table alone in its card', async () => {
  renderPage();
  const table = await screen.findByRole('table');
  const card = cardOf(table);
  const sessions = screen.getByRole('region', { name: t('en', 'attendanceBoard.sessions') });
  expect(sessions.contains(card)).toBe(true);
  expect(
    within(card).getByRole('heading', { name: t('en', 'attendanceBoard.sessions') }),
  ).toBeTruthy();
  expect(cardOf(screen.getByLabelText(t('en', 'attendanceBoard.branch')))).toBeNull();
  const refusals = await screen.findByRole('heading', {
    name: t('en', 'attendanceBoard.refusals'),
  });
  expect(card.contains(refusals)).toBe(false);
  // عنوان الجدول يحتفظ بمقاس عناوين الكتل الأخرى بدل أن يرث خط الإطار العريض.
  const title = within(card).getByText(t('en', 'attendanceBoard.sessions'));
  expect(title.className).toContain('text-lg');
  expect(title.className).toContain('font-semibold');
});

it('labels every stacked cell that has content with its column header, and not the first or the action cell', async () => {
  renderPage();
  const table = await screen.findByRole('table');
  // يُقرأ صنف التكديس من نص ثابت هنا: لو أُزيل stacked من الإطار سقط هذا الاختبار.
  expect(screen.getByRole('table').parentElement?.className).toContain(
    'max-[599.99px]:[&_table]:block',
  );
  const headers = headerTexts(table);
  const row = screen.getAllByRole('row')[1] as HTMLElement;
  const last = headers.length - 1;
  expect(cellLabels(row)).toEqual(
    headers.map((header, index) => (index === 0 || index === last ? null : header)),
  );
  const actions = within(row).getAllByRole('cell')[last] as HTMLElement;
  expect(
    within(actions).getByRole('button', { name: t('en', 'attendanceActions.history') }),
  ).toBeTruthy();
});

it('collapses the exceptions cell of a session with none and leaves it without a label', async () => {
  const [session] = boardFixture.sessions;
  const board = {
    ...boardFixture,
    sessions: [{ ...session, open_exceptions: [], corrected: false }],
  };
  api.GET.mockImplementation(async (path: string) => ({ data: answer(path, board) }));
  renderPage();
  const table = await screen.findByRole('table');
  const index = headerTexts(table).indexOf(t('en', 'attendanceBoard.exceptions'));
  const cell = within(screen.getAllByRole('row')[1] as HTMLElement).getAllByRole('cell')[
    index
  ] as HTMLElement;
  expect(cell.childElementCount).toBe(0);
  expect(cell.hasAttribute('data-cell-label')).toBe(false);
  expect(cell.className).toContain('max-[599.99px]:empty:py-0');
});

it('reads the board and the refusals once each on first mount, and no refusals while the board is refused', async () => {
  renderPage();
  await screen.findByRole('table');
  await screen.findByRole('heading', { name: t('en', 'attendanceBoard.refusals') });
  expect(boardAndRefusalReads()).toHaveLength(2);
  cleanup();
  api.GET.mockReset();
  api.GET.mockResolvedValue({ error: { code: 'FORBIDDEN' }, response: { status: 403 } });
  renderPage();
  await screen.findByRole('alert');
  expect(boardAndRefusalReads()).toHaveLength(1);
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.getByLabelText(t('en', 'attendanceBoard.branch'))).toBeTruthy();
});

it('keeps the filters and their focus when the board is refused without a remount, and shows no board data beside the refusal', async () => {
  const seen: { sessions: number; inNow: number }[] = [];
  const view = renderPage(() =>
    seen.push({
      sessions: screen.queryAllByText('Synthetic manual employee').length,
      inNow: screen.queryAllByText('Synthetic employee').length,
    }),
  );
  await screen.findByRole('table');
  const branch = screen.getByLabelText(t('en', 'attendanceBoard.branch'));
  branch.focus();
  api.GET.mockImplementation(async () => ({
    error: { code: 'FORBIDDEN' },
    response: { status: 403 },
  }));
  seen.length = 0;
  view.changeDate('2026-10-10');
  const alert = await screen.findByRole('alert');
  expect(screen.getByLabelText(t('en', 'attendanceBoard.branch'))).toBe(branch);
  expect(document.activeElement).toBe(branch);
  expect(cardOf(alert)).toBeNull();
  expect(seen.every((commit) => commit.sessions === 0 && commit.inNow === 0)).toBe(true);
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.queryByRole('heading', { name: t('en', 'attendanceBoard.refusals') })).toBeNull();
  expect(boardAndRefusalReads().filter(([path]) => path.endsWith('refusals'))).toHaveLength(1);
});
