import type { ServiceCategoryListItem, WorkspaceBranch, WorkspaceCompany } from '@pospay/contracts';
import type { WorkspaceController } from '@/workspace/model/workspace-provider';
import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
const businessListPath = '/v1/businesses/{businessId}/service-categories';

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

function workspaceWith(
  branchId: string,
  scope: WorkspaceCompany['scope'] = 'BRANCH',
): WorkspaceController {
  return {
    status: 'ready',
    company: { ...company, scope },
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
  state.get.mockImplementation(
    (path: string, options?: { params?: { query?: { status?: string } } }) => {
      if (path === branchListPath)
        return Promise.resolve({
          data: { items: [], next_cursor: null },
          response: { status: 200 },
        });
      if (path === businessListPath) {
        const closed = (options?.params?.query?.status ?? 'open') === 'closed';
        return Promise.resolve({
          data: {
            items: [
              businessCategory(
                closed ? 'Closed row' : 'Open row',
                closed ? '2026-01-01T00:00:00Z' : null,
              ),
            ],
            next_cursor: null,
          },
          response: { status: 200 },
        });
      }
      return Promise.resolve({
        error: { code: 'FORBIDDEN', message_ar: 'Forbidden AR', message_en: 'Forbidden' },
        response: { status: 403 },
      });
    },
  );
  state.workspace = workspaceWith(firstBranchId);
});

const businessCategory = (name_en: string, closed_at: string | null): ServiceCategoryListItem => ({
  id: '01920000-0000-7000-8000-0000000000c1',
  name_en,
  name_ar: `${name_en} AR`,
  visibility: 'BUSINESS',
  owner_branch_id: null,
  closed_at,
  revision: 1,
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

it('keeps the business page state across a shell branch switch for a business scope', async () => {
  state.workspace = workspaceWith(firstBranchId, 'BUSINESS');
  const view = renderRoute();
  expect(await screen.findByRole('row', { name: /Open row/ })).toBeTruthy();
  fireEvent.click(
    screen.getByRole('button', { name: t('en', 'catalogServiceCategories.tabClosed') }),
  );
  expect(await screen.findByRole('row', { name: /Closed row/ })).toBeTruthy();

  state.workspace = workspaceWith(secondBranchId, 'BUSINESS');
  view.rerender(view.ui());
  const closedTab = screen.getByRole('button', {
    name: t('en', 'catalogServiceCategories.tabClosed'),
  });
  expect(closedTab.getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('row', { name: /Closed row/ })).toBeTruthy();
  expect(screen.queryByRole('row', { name: /Open row/ })).toBeNull();
});
