import type { WorkspaceController } from '@/workspace/model/workspace-provider';
import { t } from '@pospay/i18n';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { boardBranches, boardId, otherBoardId } from '@/staff/api/attendance-board.fixture';
import { AttendanceBoardRoute } from './attendance-board-route';
const state = vi.hoisted(() => ({
  workspace: undefined as WorkspaceController | undefined,
  userId: 'user' as string | null,
  choose: vi.fn(),
  props: vi.fn(),
}));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
vi.mock('@/shared/browser/use-mounted', () => ({ useMounted: () => true }));
vi.mock('@/session/api/use-session', () => ({ useSessionUser: () => state.userId }));
vi.mock('@/workspace/model/workspace-provider', () => ({ useWorkspace: () => state.workspace }));
vi.mock('@/staff/pages/attendance-board-page', () => ({
  AttendanceBoardPage: (props: {
    scope: { branchId: string };
    date?: string;
    onDate: (date: string) => void;
    onBranch: (branchId: string) => void;
  }) => {
    state.props(props);
    return (
      <>
        <span>{props.scope.branchId}</span>
        <button onClick={() => props.onDate('2026-10-09')}>date</button>
        <button onClick={() => props.onBranch(otherBoardId)}>branch</button>
      </>
    );
  },
}));
beforeEach(() => {
  state.userId = 'user';
  state.props.mockClear();
  state.choose.mockClear();
  state.workspace = {
    status: 'ready',
    company: {
      id: boardId,
      name_ar: null,
      name_en: 'Synthetic company',
      businesses: [],
      role_code: 'viewer',
      scope: 'BRANCH',
    },
    business: {
      id: boardId,
      name_ar: null,
      name_en: 'Synthetic business',
      branches: boardBranches,
    },
    branch: boardBranches[0],
    companies: [],
    choose: state.choose,
  };
});
it('uses workspace branches and updates its branch selection without filtering permission', () => {
  render(<AttendanceBoardRoute />);
  expect(state.props.mock.calls.at(-1)?.[0].branches).toEqual(boardBranches);
  fireEvent.click(screen.getByRole('button', { name: 'branch' }));
  expect(state.choose).toHaveBeenCalledWith({
    companyId: boardId,
    businessId: boardId,
    branchId: otherBoardId,
  });
});
it('resets the date when the selected branch changes', () => {
  const view = render(<AttendanceBoardRoute />);
  fireEvent.click(screen.getByRole('button', { name: 'date' }));
  expect(state.props.mock.calls.at(-1)?.[0].date).toBe('2026-10-09');
  if (state.workspace?.status !== 'ready') throw new Error('Missing fixture');
  state.workspace = { ...state.workspace, branch: boardBranches[1] };
  view.rerender(<AttendanceBoardRoute />);
  expect(state.props.mock.calls.at(-1)?.[0].date).toBeUndefined();
  expect(screen.getByText(otherBoardId)).toBeTruthy();
});
it('asks for a business when none is selected', () => {
  if (state.workspace?.status !== 'ready') throw new Error('Missing fixture');
  state.workspace = { ...state.workspace, business: undefined };
  render(<AttendanceBoardRoute />);
  expect(screen.getByText(t('en', 'admin.chooseBusiness'))).toBeTruthy();
});
it('handles a business without branches', () => {
  if (state.workspace?.status !== 'ready' || !state.workspace.business)
    throw new Error('Missing fixture');
  state.workspace = {
    ...state.workspace,
    branch: undefined,
    business: { ...state.workspace.business, branches: [] },
  };
  render(<AttendanceBoardRoute />);
  expect(screen.getByText(t('en', 'attendanceBoard.noBranches'))).toBeTruthy();
});
it('does not mount attendance before the session and workspace are ready', () => {
  state.userId = null;
  render(<AttendanceBoardRoute />);
  expect(state.props).not.toHaveBeenCalled();
});
