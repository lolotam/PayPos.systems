import type { WorkspaceController } from '@/workspace/model/workspace-provider';
import { t } from '@pospay/i18n';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { boardBranches, boardId } from '@/staff/api/attendance-board.fixture';
import { ServiceSessionRoute } from './service-session-route';

const state = vi.hoisted(() => ({
  workspace: undefined as WorkspaceController | undefined,
  userId: null as string | null,
  choose: vi.fn(),
}));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
vi.mock('@/shared/browser/use-mounted', () => ({ useMounted: () => true }));
vi.mock('@/session/api/use-session', () => ({ useSessionUser: () => state.userId }));
vi.mock('@/workspace/model/workspace-provider', () => ({ useWorkspace: () => state.workspace }));
vi.mock('@/orders/pages/record-service-session-page', () => ({
  RecordServiceSessionPage: (props: { scope: { branchId: string } }) => (
    <>
      <span>{props.scope.branchId}</span>
      <input aria-label="draft" defaultValue="kept" />
    </>
  ),
}));
function readyWorkspace() {
  if (state.workspace?.status !== 'ready' || !state.workspace.business) throw new Error('Missing fixture');
  return state.workspace;
}
beforeEach(() => {
  state.userId = boardId;
  state.choose.mockClear();
  state.workspace = {
    status: 'ready',
    company: { id: boardId, name_ar: null, name_en: 'Synthetic company', businesses: [], role_code: 'viewer', scope: 'BRANCH' },
    business: { id: boardId, name_ar: null, name_en: 'Synthetic business', branches: boardBranches },
    branch: boardBranches[0],
    companies: [],
    choose: state.choose,
  };
});

it('asks for an explicit branch and does not adopt the first one', () => {
  const workspace = readyWorkspace();
  state.workspace = { ...workspace, branch: undefined };
  render(<ServiceSessionRoute />);
  expect(screen.getByText(t('en', 'serviceSessions.chooseBranch'))).toBeTruthy();
  expect(screen.queryByLabelText('draft')).toBeNull();
  expect(state.choose).not.toHaveBeenCalled();
});

it('asks for a business before a branch', () => {
  const workspace = readyWorkspace();
  state.workspace = { ...workspace, business: undefined, branch: undefined };
  render(<ServiceSessionRoute />);
  expect(screen.getByText(t('en', 'admin.chooseBusiness'))).toBeTruthy();
  expect(screen.queryByText(t('en', 'serviceSessions.chooseBranch'))).toBeNull();
});

it('does not mount until the workspace and the user are ready', () => {
  state.userId = null;
  const view = render(<ServiceSessionRoute />);
  expect(screen.queryByLabelText('draft')).toBeNull();
  state.userId = boardId;
  state.workspace = { status: 'loading', companies: [], choose: state.choose };
  view.rerender(<ServiceSessionRoute />);
  expect(screen.queryByLabelText('draft')).toBeNull();
});

it('remounts the editor when the branch changes and does not choose for the user', () => {
  const branch = boardBranches[1];
  if (!branch) throw new Error('Missing fixture');
  const view = render(<ServiceSessionRoute />);
  expect(screen.getByText(boardBranches[0]?.id ?? '')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('draft'), { target: { value: 'typed' } });
  const workspace = readyWorkspace();
  state.workspace = { ...workspace, branch };
  view.rerender(<ServiceSessionRoute />);
  expect(screen.getByText(branch.id)).toBeTruthy();
  expect((screen.getByLabelText('draft') as HTMLInputElement).value).toBe('kept');
  expect(state.choose).not.toHaveBeenCalled();
});
