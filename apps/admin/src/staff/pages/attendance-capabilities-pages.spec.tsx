import type { AttendanceCapabilities } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AttendanceBoardPage } from './attendance-board-page';
import { AttendanceExceptionsPage } from './attendance-exceptions-page';
import { AttendanceRequestsPage } from './attendance-requests-page';
import {
  attendanceTestClient,
  actionSession,
  exceptionPage,
  requestPage,
} from '../api/attendance-actions.fixture';
import {
  boardScope,
  boardFixture,
  boardBranches,
  boardId,
  otherBoardId,
} from '../api/attendance-board.fixture';
import { noAttendanceWrites } from '../api/use-attendance-capabilities';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
let grants: AttendanceCapabilities;
let owner: boolean;
let own: boolean;
beforeEach(() => {
  grants = { correct: true, resolve: true, request_change: true, decide: true };
  owner = false;
  own = false;
  api.GET.mockReset();
  api.POST.mockReset();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  api.GET.mockImplementation(async (path, options) => {
    if (path.endsWith('attendance-capabilities')) return { data: grants };
    if (path.endsWith('attendance-board'))
      return { data: { ...boardFixture, owner, sessions: [{ ...actionSession, own }] } };
    if (path.endsWith('attendance-exceptions'))
      return {
        data: {
          ...exceptionPage,
          next_cursor: null,
          items: exceptionPage.items.map((row) => ({ ...row, own })),
        },
      };
    if (path.endsWith('/corrections')) return { data: { items: [] } };
    if (path.endsWith('/refusals')) return { data: { items: [], next_cursor: null } };
    const first = requestPage.items[0];
    const rows = [
      { ...first, can_decide: grants.decide, can_cancel: false },
      {
        ...first,
        id: otherBoardId,
        branch_id: otherBoardId,
        employee: { id: otherBoardId, name_ar: null, name_en: 'Synthetic other branch employee' },
        can_decide: grants.decide,
        can_cancel: false,
      },
    ];
    return {
      data: {
        items: rows.filter(
          (row) =>
            !options.params.query.branch_id || row.branch_id === options.params.query.branch_id,
        ),
        next_cursor: null,
      },
    };
  });
});
function setup(kind: 'board' | 'exceptions' | 'requests') {
  const test = attendanceTestClient();
  const onBranch = vi.fn();
  const props = { scope: boardScope, branches: boardBranches, onBranch };
  const view = render(
    kind === 'board' ? (
      <AttendanceBoardPage {...props} date={undefined} onDate={vi.fn()} />
    ) : kind === 'exceptions' ? (
      <AttendanceExceptionsPage {...props} />
    ) : (
      <AttendanceRequestsPage {...props} />
    ),
    { wrapper: test.wrapper },
  );
  return {
    ...test,
    ...view,
    onBranch,
    close: () => {
      view.unmount();
      test.client.clear();
    },
  };
}
const writeNames = [
  'correct',
  'void',
  'resolve',
  'reopen',
  'manual',
  'approve',
  'reject',
  'restore',
] as const;
it.each(['board', 'exceptions', 'requests'] as const)(
  'read-only accountant sees no writes on %s',
  async (page) => {
    grants = noAttendanceWrites;
    const view = setup(page);
    await screen.findByRole('table');
    for (const name of writeNames)
      expect(
        screen.queryByRole('button', { name: t('en', `attendanceActions.${name}`) }),
      ).toBeNull();
    expect(
      screen.queryByRole('option', { name: t('en', 'attendanceActions.allBranches') }),
    ).toBeNull();
    view.close();
  },
);
it('branch manager gets correct/request actions but no decision actions or all-branches option', async () => {
  grants.decide = false;
  const board = setup('board');
  await screen.findByRole('button', { name: t('en', 'attendanceActions.correct') });
  expect(screen.getByRole('button', { name: t('en', 'attendanceActions.void') })).toBeTruthy();
  board.close();
  const requests = setup('requests');
  await screen.findByRole('table');
  expect(screen.getByRole('button', { name: t('en', 'attendanceActions.manual') })).toBeTruthy();
  expect(screen.queryByRole('button', { name: t('en', 'attendanceActions.approve') })).toBeNull();
  expect(
    screen.queryByRole('option', { name: t('en', 'attendanceActions.allBranches') }),
  ).toBeNull();
  requests.close();
});
it.each([false, true])('own correction is visible only for canonical owner=%s', async (isOwner) => {
  owner = isOwner;
  own = true;
  const view = setup('board');
  await screen.findByRole('button', { name: t('en', 'attendanceActions.history') });
  await waitFor(() =>
    expect(
      view.client.getQueryData([
        'attendance-actions',
        boardId,
        boardId,
        boardId,
        boardId,
        'capabilities',
      ]),
    ).toBeTruthy(),
  );
  expect(
    Boolean(screen.queryByRole('button', { name: t('en', 'attendanceActions.correct') })),
  ).toBe(isOwner);
  expect(Boolean(screen.queryByRole('button', { name: t('en', 'attendanceActions.void') }))).toBe(
    isOwner,
  );
  view.close();
});
it('own exception has no resolve action under spec 034', async () => {
  own = true;
  const view = setup('exceptions');
  await screen.findByRole('table');
  expect(screen.queryByRole('button', { name: t('en', 'attendanceActions.resolve') })).toBeNull();
  view.close();
});
it('owner has all write capabilities and starts with an inbox across both branches', async () => {
  const view = setup('requests');
  await screen.findByText('Synthetic other branch employee');
  expect(
    (screen.getByLabelText(t('en', 'attendanceBoard.branch')) as HTMLSelectElement).value,
  ).toBe('all');
  expect(screen.getByRole('button', { name: t('en', 'attendanceActions.manual') })).toBeTruthy();
  await waitFor(() =>
    expect(
      screen.getAllByRole('button', { name: t('en', 'attendanceActions.approve') }),
    ).toHaveLength(2),
  );
  const calls = api.GET.mock.calls.filter(([path]) => path.endsWith('attendance-change-requests'));
  expect(calls).toHaveLength(1);
  expect(calls[0]?.[1].params.query).not.toHaveProperty('branch_id');
  fireEvent.change(screen.getByLabelText(t('en', 'attendanceBoard.branch')), {
    target: { value: boardId },
  });
  await waitFor(() => expect(screen.queryByText('Synthetic other branch employee')).toBeNull());
  expect(view.onBranch).toHaveBeenCalledWith(boardId);
  expect(
    api.GET.mock.calls.filter(([path]) => path.endsWith('attendance-change-requests')).at(-1)?.[1]
      .params.query.branch_id,
  ).toBe(boardId);
  fireEvent.change(screen.getByLabelText(t('en', 'attendanceBoard.branch')), {
    target: { value: 'all' },
  });
  await screen.findByText('Synthetic other branch employee');
  view.close();
});
it('a decision about the other branch keeps that row branch scope', async () => {
  const view = setup('requests');
  const employee = await screen.findByText('Synthetic other branch employee');
  const row = employee.closest('tr');
  if (!row) throw new Error('Missing synthetic row');
  fireEvent.click(
    await within(row).findByRole('button', { name: t('en', 'attendanceActions.approve') }),
  );
  await screen.findByRole('dialog');
  expect(
    api.GET.mock.calls.some(
      ([path, options]) =>
        path.endsWith('attendance-capabilities') && options.params.path.branchId === otherBoardId,
    ),
  ).toBe(true);
  view.close();
});
it('capability loss hides writes and closes an open correction while history stays readable', async () => {
  const view = setup('board');
  fireEvent.click(
    await screen.findByRole('button', { name: t('en', 'attendanceActions.correct') }),
  );
  await screen.findByRole('dialog');
  grants = noAttendanceWrites;
  await view.client.invalidateQueries({
    queryKey: ['attendance-actions', boardId, boardId, boardId, boardId, 'capabilities'],
  });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.queryByRole('button', { name: t('en', 'attendanceActions.correct') })).toBeNull();
  expect(screen.getByRole('button', { name: t('en', 'attendanceActions.history') })).toBeTruthy();
  view.close();
});
