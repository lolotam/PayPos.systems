import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { t } from '@pospay/i18n';
import { createQueryClient } from '@/shared/api/query-client';
import { planEmployeesKey, planScope } from '@/commissions/api/plan-access';
import {
  deferredAnswer,
  EMP_A,
  employeeItem,
  employeePage,
  employeesPath,
  ok,
  refusal,
} from '@/commissions/api/__tests__/plan-http';
import { CommissionPlansNavItem } from './commission-plans-nav-item';

const api = vi.hoisted(() => ({ GET: vi.fn() }));
const state = vi.hoisted(() => ({
  userId: 'user-a' as string | null,
  workspace: null as unknown,
}));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
vi.mock('@/shared/browser/use-mounted', () => ({ useMounted: () => true }));
vi.mock('@/session/api/use-session', () => ({ useSessionUser: () => state.userId }));
vi.mock('@/workspace/model/workspace-provider', () => ({ useWorkspace: () => state.workspace }));
vi.mock('next/navigation', () => ({ usePathname: () => '/commissions/plans' }));

const id = '01920000-0000-7000-8000-0000000000b2';
const scope = planScope(id, id, 'user-a');
const LABEL = t('en', 'commissionPlanBuilder.navTitle');

let client: QueryClient;

function renderNav() {
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(<CommissionPlansNavItem />, { wrapper });
}

beforeEach(() => {
  api.GET.mockReset();
  state.userId = 'user-a';
  state.workspace = {
    status: 'ready',
    company: { id, name_ar: null, name_en: 'Synthetic company', businesses: [], role_code: 'owner', scope: 'COMPANY' },
    business: { id, name_ar: null, name_en: 'Synthetic business', branches: [] },
    branch: undefined,
    companies: [],
    choose: vi.fn(),
  };
  client = createQueryClient();
});

it('hides the entry while the first employees page is pending', () => {
  api.GET.mockReturnValue(new Promise(() => undefined));
  renderNav();
  expect(screen.queryByRole('link', { name: LABEL })).toBeNull();
});

it('hides the entry when the first employees page answers 403', async () => {
  api.GET.mockResolvedValue(refusal(403, 'FORBIDDEN'));
  renderNav();
  await waitFor(() => expect(screen.queryByRole('link', { name: LABEL })).toBeNull());
  expect(client.getQueryData([...scope, 'access'])).toMatchObject({ denied: true });
  expect(api.GET).toHaveBeenCalledTimes(1);
});

it('shows the entry after a successful first employees page', async () => {
  const pending = deferredAnswer();
  api.GET.mockImplementation(() => pending.promise);
  renderNav();
  pending.resolve(ok(employeePage([employeeItem(EMP_A, 7, 'Ø³Ø§Ø±Ø©', 'Sara')], null)));
  const link = await screen.findByRole('link', { name: LABEL });
  expect(link.getAttribute('href')).toBe('/commissions/plans');
  expect(api.GET).toHaveBeenCalledWith(
    employeesPath,
    expect.objectContaining({
      params: expect.objectContaining({
        header: { 'x-company-id': id },
        path: { businessId: id },
      }),
    }),
  );
  expect(client.getQueryData(planEmployeesKey(scope))).toBeDefined();
});

it('hides the entry for an admin without a chosen business', () => {
  state.workspace = {
    status: 'ready',
    company: { id, name_ar: null, name_en: 'Synthetic company', businesses: [], role_code: 'owner', scope: 'COMPANY' },
    business: undefined,
    branch: undefined,
    companies: [],
    choose: vi.fn(),
  };
  renderNav();
  expect(screen.queryByRole('link', { name: LABEL })).toBeNull();
});
