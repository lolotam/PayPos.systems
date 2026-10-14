import type { WorkspaceController } from '@/workspace/model/workspace-provider';
import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createSessionAttemptJournal } from '@/orders/model/session-attempt-journal';
import { id } from '@/orders/model/session-recording-result.fixture';
import { boardBranches, boardId } from '@/staff/api/attendance-board.fixture';
import { ServiceSessionRoute } from './service-session-route';

const state = vi.hoisted(() => ({
  workspace: undefined as WorkspaceController | undefined,
  userId: null as string | null,
  get: vi.fn(),
}));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
vi.mock('@/shared/browser/use-mounted', () => ({ useMounted: () => true }));
vi.mock('@/session/api/use-session', () => ({ useSessionUser: () => state.userId }));
vi.mock('@/workspace/model/workspace-provider', () => ({ useWorkspace: () => state.workspace }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: state.get, POST: vi.fn() }) }));

const service = { id: id(5), name_ar: null, name_en: 'Synthetic service', price: '7.125', revision: 1 };
const context = {
  generated_at: '2026-10-13T08:00:00.000Z', business_timezone: 'Asia/Kuwait', recorder_membership_ids: [id(8)],
  recorder_membership_id: id(8), discount_limit: { source: 'PERSON' as const, bps: 1000 },
};

function readyWorkspace() {
  if (state.workspace?.status !== 'ready' || !state.workspace.business) throw new Error('Missing fixture');
  return state.workspace;
}
function renderRoute() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const ui = () => <QueryClientProvider client={client}><ServiceSessionRoute /></QueryClientProvider>;
  return { ...render(ui()), ui };
}
async function typePrice(value: string) {
  const field = await screen.findByLabelText(t('en', 'serviceSessions.price')) as HTMLInputElement;
  fireEvent.change(field, { target: { value } });
  expect(field.value).toBe(value);
}
beforeEach(() => {
  state.userId = boardId;
  state.get.mockImplementation((path: string) => Promise.resolve({ data: String(path).endsWith('/recording-context') ? context
    : { items: String(path).endsWith('/performer-options') ? [] : [service], next_cursor: null } }));
  state.workspace = {
    status: 'ready',
    company: { id: boardId, name_ar: null, name_en: 'Synthetic company', businesses: [], role_code: 'viewer', scope: 'BRANCH' },
    business: { id: boardId, name_ar: null, name_en: 'Synthetic business', branches: boardBranches },
    branch: boardBranches[0],
    companies: [],
    choose: vi.fn(),
  };
});
afterEach(() => {
  const cleaner = createSessionAttemptJournal({ companyId: boardId, businessId: boardId, branchId: boardBranches[0]?.id ?? boardId, userId: boardId }, { now: () => Date.now(), newId: () => id(90) });
  cleaner.changeScope(null);
  cleaner.dispose();
  sessionStorage.clear();
  state.get.mockReset();
});

it('clears a typed draft when the route user or company changes', async () => {
  const view = renderRoute();
  await typePrice('20.5');
  state.userId = id(40);
  view.rerender(view.ui());
  await waitFor(() => expect((screen.getByLabelText(t('en', 'serviceSessions.price')) as HTMLInputElement).value).toBe(''));
  await typePrice('20.5');
  const workspace = readyWorkspace();
  state.workspace = { ...workspace, company: { ...workspace.company, id: id(41) } };
  view.rerender(view.ui());
  await waitFor(() => expect((screen.getByLabelText(t('en', 'serviceSessions.price')) as HTMLInputElement).value).toBe(''));
});
