import type { WorkspaceController } from '@/workspace/model/workspace-provider';
import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { boardBranches, boardId, otherBoardId } from '@/staff/api/attendance-board.fixture';
import { reportFixture } from '@/staff/api/attendance-report.fixture';
import { AttendanceReportRoute } from './attendance-report-route';
const state = vi.hoisted(() => ({
  workspace: undefined as WorkspaceController | undefined,
  userId: 'user' as string | null,
  choose: vi.fn(),
  props: vi.fn(),
  GET: vi.fn(),
}));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: state.GET }) }));
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
let client: QueryClient;
function renderRoute() {
  return render(<AttendanceReportRoute />, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  state.GET.mockReset();
  state.GET.mockResolvedValue({ error: { code: 'NOT_FOUND' }, response: { status: 404 } });
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
afterEach(() => client.clear());
it('uses the selected branch and scoped identity without a permission calculation', () => {
  renderRoute();
  expect(state.props.mock.calls.at(-1)?.[0]).toMatchObject({
    scope: { companyId: boardId, businessId: boardId, branchId: boardId, userId: 'user' },
    branches: boardBranches,
    allowAllBranches: false,
    timezone: 'Asia/Kuwait',
  });
  fireEvent.click(screen.getByRole('button', { name: 'branch' }));
  expect(state.choose).toHaveBeenCalledWith({
    companyId: boardId,
    businessId: boardId,
    branchId: otherBoardId,
  });
});
it.each(['COMPANY', 'BUSINESS', 'BRANCH'] as const)(
  'uses the business read result with company summary %s',
  async (scope) => {
    if (state.workspace?.status !== 'ready') throw new Error('Missing fixture');
    state.workspace = {
      ...state.workspace,
      company: { ...state.workspace.company, scope },
    };
    if (scope !== 'BRANCH') state.GET.mockResolvedValue({ data: reportFixture });
    renderRoute();
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(state.props.mock.calls.at(-1)?.[0].allowAllBranches).toBe(scope !== 'BRANCH');
  },
);
it('offers all branches when the selected business read succeeds despite a narrow summary', async () => {
  state.GET.mockResolvedValue({ data: reportFixture });
  renderRoute();
  await waitFor(() => expect(state.props.mock.calls.at(-1)?.[0].allowAllBranches).toBe(true));
});
it.each([
  [new Error('Synthetic network outage'), true],
  [{ code: 'NOT_READY', status: 503 }, true],
  [{ code: 'UNAUTHENTICATED', status: 401 }, false],
  [{ code: 'FORBIDDEN', status: 403 }, false],
  [{ code: 'NOT_FOUND', status: 404 }, false],
  [{ code: 'FEATURE_DISABLED', status: 409 }, false],
])(
  'retains last successful all-branches eligibility only for transient errors: %s',
  async (error, allowed) => {
    state.GET.mockResolvedValue({ data: reportFixture });
    renderRoute();
    await waitFor(() => expect(state.props.mock.calls.at(-1)?.[0].allowAllBranches).toBe(true));
    state.GET.mockRejectedValue(error);
    await act(() => client.invalidateQueries({ queryKey: ['attendance-report'] }));
    await waitFor(() => expect(client.getQueryCache().getAll()[0]?.state.status).toBe('error'));
    expect(state.props.mock.calls.at(-1)?.[0].allowAllBranches).toBe(allowed);
  },
);
it.each([
  [boardId, otherBoardId],
  [otherBoardId, boardId],
])(
  'checks selected business with BUSINESS access in %s and BRANCH access in %s',
  async (wideId, narrowId) => {
    if (state.workspace?.status !== 'ready' || !state.workspace.business)
      throw new Error('Missing fixture');
    const business = state.workspace.business;
    const wide = { ...business, id: wideId };
    const narrow = { ...business, id: narrowId };
    state.workspace = {
      ...state.workspace,
      company: { ...state.workspace.company, scope: 'BUSINESS', businesses: [wide, narrow] },
      business: narrow,
    };
    state.GET.mockImplementation(async (_path, options) =>
      options.params.path.businessId === wideId
        ? { data: reportFixture }
        : { error: { code: 'NOT_FOUND' }, response: { status: 404 } },
    );
    const view = renderRoute();
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(state.props.mock.calls.at(-1)?.[0].allowAllBranches).toBe(false);
    expect(state.GET.mock.calls.at(-1)?.[1].params.path).toEqual({ businessId: narrowId });
    state.workspace = { ...state.workspace, business: wide };
    view.rerender(<AttendanceReportRoute />);
    await waitFor(() => expect(state.props.mock.calls.at(-1)?.[0].allowAllBranches).toBe(true));
    expect(state.GET.mock.calls.at(-1)?.[1].params.path).toEqual({ businessId: wideId });
  },
);
it('uses the first business branch when no branch is selected', () => {
  if (state.workspace?.status !== 'ready') throw new Error('Missing fixture');
  state.workspace = { ...state.workspace, branch: undefined };
  renderRoute();
  expect(state.props.mock.calls.at(-1)?.[0].scope.branchId).toBe(boardId);
});
it('asks for a business when none is selected', () => {
  if (state.workspace?.status !== 'ready') throw new Error('Missing fixture');
  state.workspace = { ...state.workspace, business: undefined };
  renderRoute();
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
  renderRoute();
  expect(screen.getByText(t('en', 'attendanceBoard.noBranches'))).toBeTruthy();
});
it('waits for the session and workspace', () => {
  state.userId = null;
  const view = renderRoute();
  expect(state.props).not.toHaveBeenCalled();
  state.userId = 'user';
  state.workspace = { status: 'loading', companies: [], choose: state.choose };
  view.rerender(<AttendanceReportRoute />);
  expect(state.props).not.toHaveBeenCalled();
  expect(state.GET).not.toHaveBeenCalled();
});
