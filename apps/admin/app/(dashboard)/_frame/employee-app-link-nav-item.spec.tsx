import type { WorkspaceController } from '@/workspace/model/workspace-provider';
import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { employeeAppLinkKey } from '@/staff/api/use-employee-app-link';
import { EmployeeAppLinkNavItem } from './employee-app-link-nav-item';

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
vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

const id = '01920000-0000-7000-8000-0000000000a2';
const userId = 'user';
const label = t('en', 'employeeAppLink.title');

function renderNav() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <DirectionProvider dir="ltr">
        <EmployeeAppLinkNavItem />
      </DirectionProvider>
    </QueryClientProvider>,
  );
  return { client, ...view };
}

beforeEach(() => {
  api.GET.mockReset();
  state.userId = userId;
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
    business: { id, name_ar: null, name_en: 'Synthetic business', branches: [] },
    branch: undefined,
    companies: [],
    choose: vi.fn(),
  };
});

it('shows the staff app entry when the guarded read succeeds', async () => {
  api.GET.mockResolvedValue({
    data: {
      company_id: id,
      business_id: id,
      business_name_en: 'Synthetic business',
      business_name_ar: null,
    },
    response: { status: 200 },
  });
  renderNav();
  const link = await screen.findByRole('link', { name: label });
  expect(link.getAttribute('href')).toBe('/staff/employee-app-link');
});

it.each([403, 500])('hides the staff app entry when the read fails with %s', async (status) => {
  api.GET.mockResolvedValue({ error: { code: 'REFUSED' }, response: { status } });
  const { client } = renderNav();
  await waitFor(() =>
    expect(client.getQueryState(employeeAppLinkKey(id, userId, id))?.status).toBe('error'),
  );
  expect(screen.queryByRole('link', { name: label })).toBeNull();
});
