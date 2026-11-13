import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { leaveId } from '@/staff/api/leave-decision.fixture';
import { historyPage } from '@/staff/api/leave-history.fixture';
import { envelopeFailure, requiredRefusal } from '@/staff/api/leave-report.fixture';
import type { WorkspaceController } from '@/workspace/model/workspace-provider';
import { LeaveReportNavItem } from './leave-report-nav-item';

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

const label = t('en', 'leaveHistory.reportTitle');
const accessKey = ['leave-report-access', leaveId, leaveId, 'user'];

function renderNav() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <DirectionProvider dir="ltr">
        <LeaveReportNavItem />
      </DirectionProvider>
    </QueryClientProvider>,
  );
  return { client, ...view };
}

function workspaceWith(business: boolean): WorkspaceController {
  return {
    status: 'ready',
    company: {
      id: leaveId,
      name_ar: null,
      name_en: 'Synthetic company',
      businesses: [],
      role_code: 'owner',
      scope: 'COMPANY',
    },
    business: business
      ? { id: leaveId, name_ar: null, name_en: 'Synthetic business', branches: [] }
      : undefined,
    branch: undefined,
    companies: [],
    choose: vi.fn(),
  };
}

beforeEach(() => {
  api.GET.mockReset();
  state.userId = 'user';
  state.workspace = workspaceWith(true);
});

it('shows the leave history entry when the probe read succeeds', async () => {
  api.GET.mockResolvedValue({ data: historyPage() });
  renderNav();
  const link = await screen.findByRole('link', { name: label });
  expect(link.getAttribute('href')).toBe('/staff/leave-history');
});

it('shows the leave history entry when the heavy report refusal answers the probe', async () => {
  api.GET.mockResolvedValue(requiredRefusal());
  renderNav();
  const link = await screen.findByRole('link', { name: label });
  expect(link.getAttribute('href')).toBe('/staff/leave-history');
});

it('hides the leave history entry when the probe answers 404', async () => {
  api.GET.mockResolvedValue(envelopeFailure(404, 'NOT_FOUND'));
  const { client } = renderNav();
  await waitFor(() => expect(api.GET).toHaveBeenCalled());
  await waitFor(() => expect(client.getQueryState(accessKey)?.status).toBe('error'));
  expect(screen.queryByRole('link', { name: label })).toBeNull();
});

it('renders no entry when the workspace has no business', () => {
  state.workspace = workspaceWith(false);
  const { container } = renderNav();
  expect(api.GET).not.toHaveBeenCalled();
  expect(container.textContent).toBe('');
  expect(screen.queryByRole('link', { name: label })).toBeNull();
});
