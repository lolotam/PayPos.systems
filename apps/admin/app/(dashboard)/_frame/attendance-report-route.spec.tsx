import type { WorkspaceController } from '@/workspace/model/workspace-provider';
import { t } from '@pospay/i18n';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { boardBranches, boardId, otherBoardId } from '@/staff/api/attendance-board.fixture';
import { AttendanceReportRoute } from './attendance-report-route';
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
vi.mock('@/staff/pages/attendance-report-page', () => ({
  AttendanceReportPage: (props: { onBranch: (branchId: string) => void }) => {
    state.props(props);
    return <button onClick={() => props.onBranch(otherBoardId)}>branch</button>;
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
it('uses the selected branch and scoped identity without a permission calculation', () => {
  render(<AttendanceReportRoute />);
  expect(state.props.mock.calls.at(-1)?.[0]).toMatchObject({
    scope: { companyId: boardId, businessId: boardId, branchId: boardId, userId: 'user' },
    branches: boardBranches,
    timezone: 'Asia/Kuwait',
  });
  fireEvent.click(screen.getByRole('button', { name: 'branch' }));
  expect(state.choose).toHaveBeenCalledWith({
    companyId: boardId,
    businessId: boardId,
    branchId: otherBoardId,
  });
});
it('uses the first business branch when no branch is selected', () => {
  if (state.workspace?.status !== 'ready') throw new Error('Missing fixture');
  state.workspace = { ...state.workspace, branch: undefined };
  render(<AttendanceReportRoute />);
  expect(state.props.mock.calls.at(-1)?.[0].scope.branchId).toBe(boardId);
});
it('asks for a business when none is selected', () => {
  if (state.workspace?.status !== 'ready') throw new Error('Missing fixture');
  state.workspace = { ...state.workspace, business: undefined };
  render(<AttendanceReportRoute />);
  expect(screen.getByText(t('en', 'admin.chooseBusiness'))).toBeTruthy();
});
it('handles an empty business', () => {
  if (state.workspace?.status !== 'ready' || !state.workspace.business)
    throw new Error('Missing fixture');
  state.workspace = {
    ...state.workspace,
    branch: undefined,
    business: { ...state.workspace.business, branches: [] },
  };
  render(<AttendanceReportRoute />);
  expect(screen.getByText(t('en', 'attendanceBoard.noBranches'))).toBeTruthy();
});
it('waits for the session and workspace', () => {
  state.userId = null;
  const view = render(<AttendanceReportRoute />);
  expect(state.props).not.toHaveBeenCalled();
  state.userId = 'user';
  state.workspace = { status: 'loading', companies: [], choose: state.choose };
  view.rerender(<AttendanceReportRoute />);
  expect(state.props).not.toHaveBeenCalled();
});
