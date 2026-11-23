import { t } from '@pospay/i18n';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Profiler } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { attendanceTestClient, boardScope, requestPage } from '../api/attendance-actions.fixture';
import { boardBranches } from '../api/attendance-board.fixture';
import { AttendanceRequestsPage } from './attendance-requests-page';

const api = vi.hoisted(() => ({ GET: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

type Seen = { people: number; reasons: number; approve: number };
const noZone = boardBranches.map((branch) => ({ ...branch, effective_timezone: '' }));
let listAnswer: () => unknown;
let seen: Seen[];

function route() {
  api.GET.mockImplementation(async (path: string, options: { params: { query: unknown } }) => {
    if (path.endsWith('attendance-capabilities')) {
      return { data: { correct: false, resolve: false, request_change: true, decide: true } };
    }
    const query = options.params.query as { limit: number };
    if (query.limit === 1) return { data: { ...requestPage, can_request: false, items: [] } };
    return listAnswer();
  });
}

function listReads() {
  return api.GET.mock.calls.filter(
    ([path, options]) =>
      path.endsWith('attendance-change-requests') && options.params.query.limit !== 1,
  );
}

function recordCommit() {
  seen.push({
    people: screen.queryAllByText(/Synthetic employee/).length,
    reasons: screen.queryAllByText(/Synthetic request reason/).length,
    approve: screen.queryAllByRole('button', { name: /^approve$/i }).length,
  });
}

function page(branches: typeof boardBranches) {
  return (
    <Profiler id="requests" onRender={recordCommit}>
      <AttendanceRequestsPage scope={boardScope} branches={branches} onBranch={vi.fn()} />
    </Profiler>
  );
}

function renderPage() {
  const test = attendanceTestClient();
  const view = render(page(boardBranches), { wrapper: test.wrapper });
  return {
    client: test.client,
    withoutZone: () => view.rerender(page(noZone)),
    withZone: () => view.rerender(page(boardBranches)),
  };
}

function cachedRequestRows(client: ReturnType<typeof attendanceTestClient>['client']) {
  const { companyId, businessId, branchId, userId } = boardScope;
  return client
    .getQueryCache()
    .findAll({
      queryKey: ['attendance-actions', companyId, businessId, branchId, userId, 'requests'],
    })
    .filter((query) => query.state.data !== undefined);
}

beforeEach(() => {
  api.GET.mockReset();
  seen = [];
  listAnswer = () => ({ data: requestPage });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
});
afterEach(cleanup);

async function openDecision() {
  route();
  const view = renderPage();
  await screen.findByRole('table');
  fireEvent.click(screen.getByRole('button', { name: /^approve$/i }));
  expect(await screen.findByRole('dialog', { hidden: true })).toBeTruthy();
  return view;
}

it('shows no request row, no employee, no reason and no decision control after the time zone disappears, and clears the cache', async () => {
  const view = await openDecision();
  const status = screen.getByLabelText(t('en', 'attendanceBoard.status'));
  status.focus();
  seen = [];
  view.withoutZone();
  expect(seen.length).toBeGreaterThan(0);
  expect(seen.every((commit) => commit.people === 0 && commit.reasons === 0)).toBe(true);
  expect(seen.every((commit) => commit.approve === 0)).toBe(true);
  expect(screen.queryByRole('table')).toBeNull();
  expect(cachedRequestRows(view.client)).toHaveLength(0);
  expect(screen.getByLabelText(t('en', 'attendanceBoard.status'))).toBe(status);
  expect(document.activeElement).toBe(status);
});

it('shows no old row while the new read is pending after the time zone returns', async () => {
  const view = await openDecision();
  const status = screen.getByLabelText(t('en', 'attendanceBoard.status'));
  status.focus();
  view.withoutZone();
  const readsBefore = listReads().length;
  listAnswer = () => new Promise(() => undefined);
  seen = [];
  view.withZone();
  expect(seen.length).toBeGreaterThan(0);
  expect(seen.every((commit) => commit.people === 0 && commit.reasons === 0)).toBe(true);
  expect(seen.every((commit) => commit.approve === 0)).toBe(true);
  expect(await screen.findByRole('status')).toBeTruthy();
  expect(screen.queryByRole('table')).toBeNull();
  expect(listReads().length).toBe(readsBefore + 1);
  expect(screen.queryByRole('dialog', { hidden: true })).toBeNull();
  expect(screen.getByLabelText(t('en', 'attendanceBoard.status'))).toBe(status);
  expect(document.activeElement).toBe(status);
});
