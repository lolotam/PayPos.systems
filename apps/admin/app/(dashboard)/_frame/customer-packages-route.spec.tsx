import type { WorkspaceController } from '@/workspace/model/workspace-provider';
import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CustomerPackagesRoute } from './customer-packages-route';

const api = vi.hoisted(() => ({ GET: vi.fn() }));
const state = vi.hoisted(() => ({
  workspace: undefined as WorkspaceController | undefined,
  userId: 'user' as string | null,
}));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
vi.mock('@/shared/browser/use-mounted', () => ({ useMounted: () => true }));
vi.mock('@/session/api/use-session', () => ({ useSessionUser: () => state.userId }));
vi.mock('@/workspace/model/workspace-provider', () => ({ useWorkspace: () => state.workspace }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}));

const id = '01920000-0000-7000-8000-000000000101';
const customerId = '01920000-0000-7000-8000-0000000000f1';

function renderRoute() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DirectionProvider dir="ltr">
        <CustomerPackagesRoute customerId={customerId} />
      </DirectionProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.GET.mockReset();
  api.GET.mockResolvedValue({ data: { items: [], next_cursor: null }, response: { status: 200 } });
  state.userId = 'user';
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
