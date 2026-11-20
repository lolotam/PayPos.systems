import type { WorkspaceBranch, WorkspaceCompany } from '@pospay/contracts';
import type { WorkspaceController } from '@/workspace/model/workspace-provider';
import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ServiceCategoriesRoute } from './service-categories-route';

const state = vi.hoisted(() => ({
  workspace: undefined as WorkspaceController | undefined,
  userId: 'user-1' as string | null,
  get: vi.fn(),
}));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: state.get }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
vi.mock('@/shared/browser/use-mounted', () => ({ useMounted: () => true }));
vi.mock('@/session/api/use-session', () => ({ useSessionUser: () => state.userId }));
vi.mock('@/workspace/model/workspace-provider', () => ({ useWorkspace: () => state.workspace }));

const companyId = '01920000-0000-7000-8000-000000000001';
const businessId = '01920000-0000-7000-8000-000000000002';
const firstBranchId = '01920000-0000-7000-8000-0000000000b1';
const secondBranchId = '01920000-0000-7000-8000-0000000000b2';
const branchListPath = '/v1/businesses/{businessId}/branches/{branchId}/service-categories';

const branches: WorkspaceBranch[] = [
  {
    id: firstBranchId,
    name_en: 'First branch',
    name_ar: null,
    effective_timezone: 'Asia/Kuwait',
    is_active: true,
  },
  {
    id: secondBranchId,
    name_en: 'Second branch',
    name_ar: null,
    effective_timezone: 'Asia/Kuwait',
    is_active: true,
  },
];
const company: WorkspaceCompany = {
  id: companyId,
  name_en: 'Company',
  name_ar: null,
  businesses: [],
  role_code: 'owner',
  scope: 'BRANCH',
};

function workspaceWith(branchId: string): WorkspaceController {
  return {
    status: 'ready',
    company,
    business: { id: businessId, name_en: 'Business', name_ar: null, branches },
    branch: branches.find((branch) => branch.id === branchId),
    companies: [],
    choose: vi.fn(),
  };
}

function renderRoute() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = () => (
    <QueryClientProvider client={client}>
      <ServiceCategoriesRoute />
    </QueryClientProvider>
  );
  return { ...render(ui()), ui };
}

function lastBranchCall(): string | undefined {
  const calls = state.get.mock.calls.filter(([path]) => path === branchListPath);
  const params = calls.at(-1)?.[1] as { params?: { path?: { branchId?: string } } } | undefined;
  return params?.params?.path?.branchId;
}

beforeEach(() => {
  state.get.mockReset();
  state.userId = 'user-1';
  state.get.mockImplementation((path: string) => {
    if (path === branchListPath)
      return Promise.resolve({ data: { items: [], next_cursor: null }, response: { status: 200 } });
    return Promise.resolve({
      error: { code: 'FORBIDDEN', message_ar: 'Forbidden AR', message_en: 'Forbidden' },
      response: { status: 403 },
    });
  });
  state.workspace = workspaceWith(firstBranchId);
});

it('follows a workspace branch switch by remounting on the newly remembered branch', async () => {
  const view = renderRoute();
  const select = (await screen.findByRole('combobox', {
    name: t('en', 'catalogServiceCategoryBranches.scopeLabel'),
  })) as HTMLSelectElement;
  expect(select.selectedOptions[0]?.textContent).toBe('First branch');
  await waitFor(() => expect(lastBranchCall()).toBe(firstBranchId));

  state.workspace = workspaceWith(secondBranchId);
  view.rerender(view.ui());
  expect(
    (
      screen.getByRole('combobox', {
        name: t('en', 'catalogServiceCategoryBranches.scopeLabel'),
      }) as HTMLSelectElement
    ).selectedOptions[0]?.textContent,
  ).toBe('Second branch');
  await waitFor(() => expect(lastBranchCall()).toBe(secondBranchId));
});
