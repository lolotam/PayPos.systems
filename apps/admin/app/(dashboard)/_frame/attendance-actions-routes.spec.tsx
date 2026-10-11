import type { WorkspaceController } from '@/workspace/model/workspace-provider';
import { t } from '@pospay/i18n';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { boardBranches, boardId, otherBoardId } from '@/staff/api/attendance-board.fixture';
import { AttendanceExceptionsRoute } from './attendance-exceptions-route';
import { AttendanceRequestsRoute } from './attendance-requests-route';
const state = vi.hoisted(() => ({
  workspace: undefined as WorkspaceController | undefined,
  userId: 'Synthetic user' as string | null,
  choose: vi.fn(),
  props: vi.fn(),
}));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
vi.mock('@/shared/browser/use-mounted', () => ({ useMounted: () => true }));
vi.mock('@/session/api/use-session', () => ({ useSessionUser: () => state.userId }));
vi.mock('@/workspace/model/workspace-provider', () => ({ useWorkspace: () => state.workspace }));
type PageProps = { scope: { branchId: string; userId: string }; onBranch: (id: string) => void };
vi.mock('@/staff/pages/attendance-exceptions-page', () => ({
  AttendanceExceptionsPage: (props: PageProps) => {
    state.props(props);
    return <button onClick={() => props.onBranch(otherBoardId)}>{props.scope.branchId}</button>;
  },
}));
vi.mock('@/staff/pages/attendance-requests-page', () => ({
  AttendanceRequestsPage: (props: PageProps) => {
    state.props(props);
    return <button onClick={() => props.onBranch(otherBoardId)}>{props.scope.branchId}</button>;
  },
}));
beforeEach(() => {
  state.userId = 'Synthetic user';
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
    branch: undefined,
    companies: [],
    choose: state.choose,
  };
});
it.each([AttendanceExceptionsRoute, AttendanceRequestsRoute])(
  'uses the branch fallback without a client permission decision',
  (Route) => {
    render(<Route />);
    expect(state.props.mock.calls[0]?.[0].scope).toEqual({
      companyId: boardId,
      businessId: boardId,
      branchId: boardId,
      userId: 'Synthetic user',
    });
    fireEvent.click(screen.getByRole('button'));
    expect(state.choose).toHaveBeenCalledWith({
      companyId: boardId,
      businessId: boardId,
      branchId: otherBoardId,
    });
  },
);
it.each([AttendanceExceptionsRoute, AttendanceRequestsRoute])(
  'waits for the authenticated workspace and handles absent business',
  (Route) => {
    state.userId = null;
    const view = render(<Route />);
    expect(state.props).not.toHaveBeenCalled();
    state.userId = 'Synthetic user';
    state.workspace = { ...state.workspace, business: undefined } as WorkspaceController;
    view.rerender(<Route />);
    expect(screen.getByText(t('en', 'admin.chooseBusiness'))).toBeTruthy();
  },
);
