import type { WorkspaceController } from '@/workspace/model/workspace-provider';
import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { BusinessIdentityNavItem } from './business-identity-nav-item';

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
const label = t('en', 'businessIdentity.title');

function renderNav() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DirectionProvider dir="ltr">
        <BusinessIdentityNavItem />
      </DirectionProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.GET.mockReset();
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
    business: { id, name_ar: null, name_en: 'Synthetic business', branches: [] },
    branch: undefined,
    companies: [],
    choose: vi.fn(),
  };
});

it('hides the entry when the capability read says the caller cannot manage identity', async () => {
  api.GET.mockResolvedValue({ data: { can_manage_identity: false }, response: { status: 200 } });
  renderNav();
  await waitFor(() => expect(api.GET).toHaveBeenCalled());
  expect(screen.queryByRole('link', { name: label })).toBeNull();
});

it('hides the entry while the capability read is loading or failed', async () => {
  api.GET.mockReturnValue(new Promise(() => undefined));
  const pending = renderNav();
  expect(screen.queryByRole('link', { name: label })).toBeNull();
  pending.unmount();
  api.GET.mockResolvedValue({ error: { code: 'UNEXPECTED' }, response: { status: 500 } });
  renderNav();
  await waitFor(() => expect(api.GET).toHaveBeenCalled());
  expect(screen.queryByRole('link', { name: label })).toBeNull();
});

it('shows the entry when the capability read allows identity management', async () => {
  api.GET.mockResolvedValue({ data: { can_manage_identity: true }, response: { status: 200 } });
  renderNav();
  const link = await screen.findByRole('link', { name: label });
  expect(link.getAttribute('href')).toBe('/business-identity');
  expect(api.GET).toHaveBeenCalledWith(
    '/v1/businesses/{businessId}/settings/identity-capability',
    expect.objectContaining({
      params: expect.objectContaining({
        header: { 'x-company-id': id },
        path: { businessId: id },
      }),
    }),
  );
});

it('does not show the entry or read the capability before a business is selected', () => {
  if (state.workspace?.status !== 'ready') throw new Error('missing workspace');
  state.workspace = { ...state.workspace, business: undefined };
  renderNav();
  expect(screen.queryByRole('link', { name: label })).toBeNull();
  expect(api.GET).not.toHaveBeenCalled();
});
