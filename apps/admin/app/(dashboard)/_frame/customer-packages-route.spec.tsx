import type { WorkspaceController } from '@/workspace/model/workspace-provider';
import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CustomerPackagesRoute } from './customer-packages-route';

const api = vi.hoisted(() => ({ GET: vi.fn() }));
const state = vi.hoisted(() => ({
  workspace: undefined as WorkspaceController | undefined,
  userId: 'user' as string | null,
  search: '',
  replace: vi.fn(),
}));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
vi.mock('@/shared/browser/use-mounted', () => ({ useMounted: () => true }));
vi.mock('@/session/api/use-session', () => ({ useSessionUser: () => state.userId }));
vi.mock('@/workspace/model/workspace-provider', () => ({ useWorkspace: () => state.workspace }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: state.replace }),
  useSearchParams: () => new URLSearchParams(state.search),
}));

const id = '01920000-0000-7000-8000-000000000101';
const customerId = '01920000-0000-7000-8000-0000000000f1';

function renderRoute() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const route = () => (
    <QueryClientProvider client={client}>
      <DirectionProvider dir="ltr">
        <CustomerPackagesRoute customerId={customerId} />
      </DirectionProvider>
    </QueryClientProvider>
  );
  const view = render(route());
  return { ...view, rerenderRoute: () => view.rerender(route()) };
}

beforeEach(() => {
  api.GET.mockReset();
  api.GET.mockResolvedValue({ data: { items: [], next_cursor: null }, response: { status: 200 } });
  state.userId = 'user';
  state.search = '';
  state.replace.mockReset();
  state.workspace = {
    status: 'ready',
    company: {
      id,
      name_ar: null,
      name_en: 'Synthetic company',
      businesses: [],
      role_code: 'owner',
      scope: 'COMPANY',
    },
    business: {
      id,
      name_ar: null,
      name_en: 'Synthetic business',
      branches: [
        {
          id,
          name_ar: null,
          name_en: 'Synthetic branch',
          effective_timezone: 'Asia/Kuwait',
          is_active: true,
        },
      ],
    },
    branch: {
      id,
      name_ar: null,
      name_en: 'Synthetic branch',
      effective_timezone: 'Asia/Kuwait',
      is_active: true,
    },
    companies: [],
    choose: vi.fn(),
  };
});

it('renders the screen under a ready workspace with the generic heading', async () => {
  renderRoute();
  const heading = await screen.findByRole('heading', { name: t('en', 'customerPackages.title') });
  expect(heading.textContent).toBe(t('en', 'customerPackages.title'));
  expect(api.GET).toHaveBeenCalledWith(
    '/v1/businesses/{businessId}/branches/{branchId}/customers/{customerId}/packages',
    expect.objectContaining({
      params: expect.objectContaining({
        header: { 'x-company-id': id },
        path: { businessId: id, branchId: id, customerId },
      }),
    }),
  );
});

type RouteVariant =
  | { ready: true; business: false }
  | { ready: true; business: true; branch?: false }
  | { ready: false };

it.each<readonly [string, RouteVariant]>([
  ['no business', { ready: true, business: false }],
  ['no branch', { ready: true, business: true, branch: false }],
  ['not ready', { ready: false }],
])('%s shows the same choose prompts the package-sale route shows', (_name, variant) => {
  if (variant.ready) {
    if (state.workspace?.status !== 'ready') throw new Error('missing workspace');
    state.workspace = {
      ...state.workspace,
      ...(variant.business ? {} : { business: undefined }),
      ...(!variant.business || variant.branch === undefined || variant.branch
        ? {}
        : { branch: undefined }),
    };
  } else {
    state.workspace = {
      status: 'loading',
      companies: [],
      choose: vi.fn(),
    } as unknown as WorkspaceController;
  }
  const view = renderRoute();
  if (!variant.ready) {
    expect(view.container.textContent).toBe('');
  } else if (variant.business === false) {
    expect(view.getByText(t('en', 'admin.chooseBusiness'))).toBeTruthy();
  } else if (variant.branch === false) {
    expect(view.getByText(t('en', 'serviceSessions.chooseBranch'))).toBeTruthy();
  }
  expect(api.GET).not.toHaveBeenCalled();
});

it('drops a direct package selection on a workspace change before fetching the new scope', async () => {
  const entitlementId = '01920000-0000-7000-8000-0000000000a1';
  const otherBranch = '01920000-0000-7000-8000-000000000103';
  const detailPath =
    '/v1/businesses/{businessId}/branches/{branchId}/customers/{customerId}/packages/{entitlementId}';
  state.search = '?package=' + entitlementId;
  api.GET.mockImplementation((path: string) =>
    path === detailPath
      ? new Promise(() => undefined)
      : Promise.resolve({ data: { items: [], next_cursor: null }, response: { status: 200 } }),
  );
  const view = renderRoute();
  await screen.findByText(t('en', 'customerPackages.detailLoading'));
  expect(api.GET.mock.calls.filter(([path]) => path === detailPath)).toHaveLength(1);

  if (state.workspace?.status !== 'ready' || !state.workspace.branch) {
    throw new Error('missing workspace');
  }
  state.workspace = { ...state.workspace, branch: { ...state.workspace.branch, id: otherBranch } };
  view.rerenderRoute();
  await waitFor(() => expect(state.replace).toHaveBeenCalledWith('?'));
  await screen.findByText(t('en', 'customerPackages.empty'));
  expect(screen.queryByText(t('en', 'customerPackages.detailLoading'))).toBeNull();
  expect(api.GET.mock.calls.filter(([path]) => path === detailPath)).toHaveLength(1);
});

it.each(['ready', 'incomplete', 'choose'] as const)(
  'restores the linked scope and package from %s',
  async (selection) => {
    if (
      state.workspace?.status !== 'ready' ||
      !state.workspace.branch ||
      !state.workspace.business
    ) {
      throw new Error('missing workspace');
    }
    const entitlementId = '01920000-0000-7000-8000-0000000000a1';
    const linkedBranch = { ...state.workspace.branch, id: '01920000-0000-7000-8000-000000000103' };
    const linkedBusiness = { ...state.workspace.business, branches: [linkedBranch] };
    const linkedCompany = { ...state.workspace.company, businesses: [linkedBusiness] };
    const linkedScope = {
      ...state.workspace,
      company: linkedCompany,
      companies: [linkedCompany],
      business: linkedBusiness,
      branch: linkedBranch,
    };
    const choose = vi.fn(() => {
      state.workspace = linkedScope;
    });
    state.workspace =
      selection === 'choose'
        ? { status: 'choose', companies: [linkedCompany], choose }
        : {
            ...state.workspace,
            companies: [linkedCompany],
            ...(selection === 'incomplete' ? { business: undefined, branch: undefined } : {}),
            choose,
          };
    const params = new URLSearchParams({
      scope_company: linkedCompany.id,
      scope_business: linkedBusiness.id,
      scope_branch: linkedBranch.id,
      package: entitlementId,
    });
    state.search = '?' + params.toString();
    const list = { data: { items: [], next_cursor: null }, response: { status: 200 } };
    api.GET.mockResolvedValueOnce(list).mockReturnValue(new Promise(() => undefined));
    const view = renderRoute();
    const switchScope = screen.getByRole('button', {
      name: t('en', 'customerPackages.scopeSwitch'),
    });
    expect(api.GET).not.toHaveBeenCalled();
    act(() => {
      fireEvent.click(switchScope);
      view.rerenderRoute();
    });
    expect(choose).toHaveBeenCalledWith({
      companyId: linkedCompany.id,
      businessId: linkedBusiness.id,
      branchId: linkedBranch.id,
    });
    expect(await screen.findByText(t('en', 'customerPackages.detailLoading'))).toBeTruthy();
    expect(state.replace).not.toHaveBeenCalled();
  },
);
