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
  post: vi.fn(),
}));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
vi.mock('@/shared/browser/use-mounted', () => ({ useMounted: () => true }));
vi.mock('@/session/api/use-session', () => ({ useSessionUser: () => state.userId }));
vi.mock('@/workspace/model/workspace-provider', () => ({ useWorkspace: () => state.workspace }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: state.get, POST: state.post }) }));

const service = { id: id(5), name_ar: null, name_en: 'Synthetic service', price: '7.125', revision: 1 };
const savedCustomer = { id: id(7), name: 'Synthetic customer', locale: 'en' as const, opted_out: false, phone: '***001' };
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
async function selectCustomer() {
  await screen.findByLabelText(t('en', 'serviceSessions.name'));
  for (const [key, value] of [['name', 'Synthetic customer'], ['callingCode', '999'], ['phone', '00000001']] as const) {
    fireEvent.change(screen.getByLabelText(t('en', `serviceSessions.${key}`)), { target: { value } });
  }
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.findOrCreate') }));
  expect(await screen.findByText('***001')).toBeTruthy();
}
async function expectCustomerCleared() {
  await screen.findByLabelText(t('en', 'serviceSessions.name'));
  await waitFor(() => expect(screen.queryByText('***001')).toBeNull());
}
beforeEach(() => {
  state.userId = boardId;
  state.post.mockImplementation((path: string) => String(path).endsWith('/find-or-create')
    ? Promise.resolve({ data: savedCustomer }) : Promise.reject(new Error('unexpected write')));
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
  state.post.mockReset();
});

it('clears the selected customer when the route user changes', async () => {
  const view = renderRoute();
  await selectCustomer();
  state.userId = id(40);
  view.rerender(view.ui());
  await expectCustomerCleared();
});

it('clears the selected customer when the route company changes', async () => {
  const view = renderRoute();
  await selectCustomer();
  const workspace = readyWorkspace();
  state.workspace = { ...workspace, company: { ...workspace.company, id: id(41) } };
  view.rerender(view.ui());
  await expectCustomerCleared();
});
