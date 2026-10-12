import { t } from '@pospay/i18n';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AttendanceRequestsPage } from '../pages/attendance-requests-page';
import { boardBranches } from '../api/attendance-board.fixture';
import {
  attendanceTestClient,
  boardScope,
  boardId,
  otherBoardId,
  requestPage,
  requestRecord,
} from '../api/attendance-actions.fixture';
import {
  restoreAttendanceInput,
  type AttendanceRequestRow,
} from '../model/attendance-action-display';
import { AttendanceRequestRowActions } from './attendance-request-row-actions';
const state = vi.hoisted(() => ({ locale: 'en' as 'ar' | 'en' }));
const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
const pendingVoid = requestPage.items[0] as AttendanceRequestRow;
const approvedVoid: AttendanceRequestRow = {
  ...pendingVoid,
  status: 'APPROVED',
  can_decide: false,
  can_cancel: false,
  decided_by: otherBoardId,
  decided_at: '2026-10-11T05:00:00Z',
  session_state: { voided: true, void_request_id: boardId, restore_pending: false },
};
beforeEach(() => {
  state.locale = 'en';
  api.GET.mockReset();
  api.POST.mockReset();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
});
const eligibility: [AttendanceRequestRow['session_state'], boolean][] = [
  [null, false],
  [{ voided: false, void_request_id: null, restore_pending: false }, false],
  [{ voided: true, void_request_id: null, restore_pending: false }, false],
  [{ voided: true, void_request_id: otherBoardId, restore_pending: false }, false],
  [{ voided: true, void_request_id: boardId, restore_pending: true }, false],
  [{ voided: true, void_request_id: boardId, restore_pending: false }, true],
];
it.each(eligibility)(
  'offers restore only for the current void without a pending restore: %s',
  (session_state, allowed) => {
    const row = { ...approvedVoid, session_state };
    render(<AttendanceRequestRowActions row={row} onAction={vi.fn()} />);
    expect(
      Boolean(screen.queryByRole('button', { name: t('en', 'attendanceActions.restore') })),
    ).toBe(allowed);
    expect(Boolean(restoreAttendanceInput(row, 'Synthetic reason'))).toBe(allowed);
  },
);
async function approveRequest() {
  fireEvent.click(
    await screen.findByRole('button', { name: t('en', 'attendanceActions.approve') }),
  );
  fireEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: t('en', 'attendanceActions.approve'),
    }),
  );
}
it('approves a void, requests restore, then approves restore and refreshes without offering another restore', async () => {
  let rows = [pendingVoid];
  const pendingRestore: AttendanceRequestRow = {
    ...pendingVoid,
    id: otherBoardId,
    kind: 'RESTORE_SESSION',
    session_revision: 4,
    session_state: { voided: true, void_request_id: boardId, restore_pending: true },
  };
  api.GET.mockImplementation(async () => ({ data: { items: rows, next_cursor: null } }));
  api.POST.mockImplementation(async (path) => {
    if (!path.endsWith('/decide')) {
      rows = [{ ...approvedVoid, session_state: pendingRestore.session_state }, pendingRestore];
      return { data: { ...requestRecord, id: otherBoardId, kind: 'RESTORE_SESSION' } };
    }
    rows =
      rows.length === 1
        ? [approvedVoid]
        : [
            {
              ...approvedVoid,
              session_state: { voided: false, void_request_id: null, restore_pending: false },
            },
            { ...pendingRestore, status: 'APPROVED', can_decide: false, can_cancel: false },
          ];
    return { data: { ...requestRecord, effect: null } };
  });
  const test = attendanceTestClient();
  const view = render(
    <AttendanceRequestsPage scope={boardScope} branches={boardBranches} onBranch={vi.fn()} />,
    { wrapper: test.wrapper },
  );
  await approveRequest();
  fireEvent.click(
    await screen.findByRole('button', { name: t('en', 'attendanceActions.restore') }),
  );
  fireEvent.change(screen.getByLabelText(t('en', 'attendanceActions.reason')), {
    target: { value: 'Synthetic restore reason' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'attendanceActions.save') }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.queryByRole('button', { name: t('en', 'attendanceActions.restore') })).toBeNull();
  await approveRequest();
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(api.POST).toHaveBeenCalledTimes(3);
  expect(api.GET).toHaveBeenCalledTimes(4);
  expect(screen.queryByRole('button', { name: t('en', 'attendanceActions.restore') })).toBeNull();
  expect(screen.queryByRole('button', { name: t('en', 'attendanceActions.approve') })).toBeNull();
  view.unmount();
  test.client.clear();
});
