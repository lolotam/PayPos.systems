import type { WorkspaceController } from '@/workspace/model/workspace-provider';
import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { alertRulesKey } from '@/settings/alert-rules/api/alert-rules-client';
import { AlertRulesNavItem } from './alert-rules-nav-item';

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
const label = t('en', 'alertRules.title');
const ratingPath = '/v1/businesses/{businessId}/rating-settings';

function rules() {
  return { business_id: id, branch_id: null, alerts_enabled: true, rules: [] };
}

// المساران مختلفين: التنبيهات ومفتاح طلبات التقييم، وكل واحد بيرد بردّه.
function mockGet(rulesAnswer: unknown, ratingAnswer: unknown) {
  api.GET.mockImplementation((path: string) =>
    Promise.resolve(path === ratingPath ? ratingAnswer : rulesAnswer),
  );
}

function renderNav() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <DirectionProvider dir="ltr">
        <AlertRulesNavItem />
      </DirectionProvider>
    </QueryClientProvider>,
  );
  return { client, ...view };
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

it('hides the entry while the business rules read is pending', () => {
  api.GET.mockReturnValue(new Promise(() => undefined));
  renderNav();
  expect(screen.queryByRole('link', { name: label })).toBeNull();
});

it.each([500, 403])('hides the entry when the business read answers %i', async (status) => {
  api.GET.mockResolvedValue({
    error: { code: 'FORBIDDEN', message_ar: 'Synthetic refusal', message_en: 'Synthetic refusal' },
    response: { status },
  });
  const { client } = renderNav();
  await waitFor(() =>
    expect(client.getQueryState(alertRulesKey(id, 'user', id, null))?.status).toBe('error'),
  );
  expect(screen.queryByRole('link', { name: label })).toBeNull();
});

it('shows the entry after a successful business read', async () => {
  mockGet({ data: rules() }, { data: { requests_enabled: true } });
  renderNav();
  const link = await screen.findByRole('link', { name: label });
  expect(link.getAttribute('href')).toBe('/alert-rules');
  expect(api.GET).toHaveBeenCalledWith(
    '/v1/businesses/{businessId}/alert-rules',
    expect.objectContaining({
      params: expect.objectContaining({
        header: { 'x-company-id': id },
        path: { businessId: id },
      }),
    }),
  );
});

it('shows the entry when only the rating settings read succeeds', async () => {
  const refusal = {
    error: { code: 'FORBIDDEN', message_ar: 'Synthetic refusal', message_en: 'Synthetic refusal' },
    response: { status: 403 },
  };
  mockGet(refusal, { data: { requests_enabled: true } });
  renderNav();
  const link = await screen.findByRole('link', { name: label });
  expect(link.getAttribute('href')).toBe('/alert-rules');
});
