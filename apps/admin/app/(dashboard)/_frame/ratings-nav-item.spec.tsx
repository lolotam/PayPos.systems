import type { WorkspaceController } from '@/workspace/model/workspace-provider';
import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { RatingsNavItem } from './ratings-nav-item';

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
vi.mock('next/navigation', () => ({ usePathname: () => '/ratings' }));

const id = '01920000-0000-7000-8000-0000000000a3';
const label = t('en', 'ratings.title');

function renderNav() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DirectionProvider dir="ltr">
        <RatingsNavItem />
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

it('shows the link to the ratings page once the list read succeeds', async () => {
  api.GET.mockResolvedValue({ data: { items: [], next_cursor: null }, response: { status: 200 } });
  renderNav();
  const link = await screen.findByRole('link', { name: label });
  expect(link.getAttribute('href')).toBe('/ratings');
  expect(api.GET.mock.calls[0]?.[1].params.query).toEqual({ limit: 1 });
});

it('keeps the link hidden while the read is pending', () => {
  api.GET.mockReturnValue(new Promise(() => undefined));
  renderNav();
  expect(screen.queryByRole('link', { name: label })).toBeNull();
});

it.each([403, 500])('hides the link when the list answers %i', async (status) => {
  api.GET.mockResolvedValue({
    error: { code: 'FORBIDDEN', message_ar: 'Synthetic', message_en: 'Synthetic' },
    response: { status },
  });
  renderNav();
  await waitFor(() => expect(api.GET).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.queryByRole('link', { name: label })).toBeNull());
});
