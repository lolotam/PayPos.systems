import type { WorkspaceController } from '@/workspace/model/workspace-provider';
import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { EmployeeDetailRoute } from './employee-detail-route';

const state = vi.hoisted(() => ({
  workspace: undefined as WorkspaceController | undefined,
  userId: 'user' as string | null,
  search: '',
}));
vi.mock('@/shared/api/client', () => ({
  apiClient: () => ({
    GET: () =>
      Promise.resolve({
        error: { code: 'NOT_FOUND', message_en: 'Synthetic missing', message_ar: 'Synthetic missing' },
        response: { status: 404 },
      }),
  }),
}));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
vi.mock('@/shared/browser/use-mounted', () => ({ useMounted: () => true }));
vi.mock('@/session/api/use-session', () => ({ useSessionUser: () => state.userId }));
vi.mock('@/workspace/model/workspace-provider', () => ({ useWorkspace: () => state.workspace }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(state.search),
  useRouter: () => ({ push: vi.fn() }),
}));

const business = {
  id: 'business-1',
  name_ar: null,
  name_en: 'Synthetic business',
  business_type: 'salon' as const,
  country: null,
  branches: [],
};

function ready(chosen: typeof business | null): WorkspaceController {
  return {
    status: 'ready',
    company: {
      id: 'company-1',
      name_ar: null,
      name_en: 'Synthetic company',
      businesses: [],
      role_code: 'owner',
      scope: 'COMPANY',
    },
    business: chosen,
    branch: null,
    companies: [],
    choose: vi.fn(),
  } as unknown as WorkspaceController;
}

function route(props: { employeeId: string; tab?: 'leave' }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <EmployeeDetailRoute {...props} />
    </QueryClientProvider>
  );
}
const currentTab = () =>
  screen
    .getAllByRole('link')
    .find((link) => link.getAttribute('aria-current') === 'page')
    ?.getAttribute('href');

beforeEach(() => {
  state.workspace = ready(business);
  state.userId = 'user';
  state.search = '';
});

it.each([
  ['', '/staff/e1'],
  ['tab=pay', '/staff/e1?tab=pay'],
  ['tab=hours', '/staff/e1?tab=hours'],
  ['tab=documents', '/staff/e1?tab=documents'],
  ['tab=nonsense', '/staff/e1'],
  ['tab=leave', '/staff/e1'],
] as const)('reads ?%s and marks %s current', (search, href) => {
  state.search = search;
  render(route({ employeeId: 'e1' }));
  expect(currentTab()).toBe(href);
});

it('shows Leave from its own address whatever the query says', () => {
  state.search = 'tab=pay';
  render(route({ employeeId: 'e1', tab: 'leave' }));
  expect(currentTab()).toBe('/staff/e1/leave');
});

it('shows the record error state inside the page for an id the API does not know', async () => {
  render(route({ employeeId: 'not-a-uuid' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Synthetic missing');
  expect(screen.getByRole('link', { name: t('en', 'staff.cancel') }).getAttribute('href')).toBe(
    '/staff',
  );
});

it('renders nothing until the workspace is ready and the session user is known', () => {
  state.workspace = { status: 'loading' } as unknown as WorkspaceController;
  const view = render(route({ employeeId: 'e1' }));
  expect(view.container.textContent).toBe('');
  state.workspace = ready(business);
  state.userId = null;
  view.rerender(route({ employeeId: 'e1' }));
  expect(view.container.textContent).toBe('');
});

it('asks for a business when none is selected', () => {
  state.workspace = ready(null);
  render(route({ employeeId: 'e1' }));
  expect(screen.getByText(t('en', 'admin.chooseBusiness'))).toBeTruthy();
});
