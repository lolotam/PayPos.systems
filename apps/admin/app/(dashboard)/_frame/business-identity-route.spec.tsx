import type { WorkspaceController } from '@/workspace/model/workspace-provider';
import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { BusinessIdentityRoute } from './business-identity-route';

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

const id = '01920000-0000-7000-8000-0000000000a2';
const retry = t('en', 'pos.retry');

function renderRoute() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <BusinessIdentityRoute />
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

it('shows a loading status while the capability is pending', () => {
  api.GET.mockReturnValue(new Promise(() => undefined));
  renderRoute();
  expect(screen.getByRole('status').textContent).toBe(t('en', 'admin.loading'));
  expect(screen.queryByRole('alert')).toBeNull();
});

it('shows the capability failure and retries the read', async () => {
  api.GET.mockResolvedValue({
    error: { code: 'UNEXPECTED', message_ar: 'Offline', message_en: 'Offline' },
    response: { status: 500 },
  });
  renderRoute();
  expect((await screen.findByRole('alert')).textContent).toContain('Offline');
  fireEvent.click(screen.getByRole('button', { name: retry }));
  await waitFor(() => expect(api.GET).toHaveBeenCalledTimes(2));
});

it('shows a forbidden alert when the caller cannot manage identity', async () => {
  api.GET.mockResolvedValue({ data: { can_manage_identity: false }, response: { status: 200 } });
  renderRoute();
  expect((await screen.findByRole('alert')).textContent).toContain(t('en', 'errors.FORBIDDEN'));
  expect(screen.queryByRole('button', { name: retry })).toBeNull();
});
