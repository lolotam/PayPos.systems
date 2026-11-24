import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ImportedRefundsPage } from './imported-refunds-page';

const api = vi.hoisted(() => ({ GET: vi.fn(), PUT: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const id = '01920000-0000-7000-8000-0000000000c1';

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <DirectionProvider dir="ltr">
        <ImportedRefundsPage companyId={id} userId="user" businessId={id} />
      </DirectionProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.GET.mockReset();
  api.PUT.mockReset();
  api.GET.mockResolvedValue({
    data: { imported_refunds_enabled: false },
    response: { status: 200 },
  });
});

it('puts the switch in one card under the header of the list shell', async () => {
  renderPage();
  const control = await screen.findByRole('switch', { name: t('en', 'importedRefunds.label') });
  const heading = screen.getByRole('heading', { name: t('en', 'importedRefunds.title') });
  const shell = heading.closest('[data-page-shell="list"]');
  expect(shell).not.toBeNull();
  expect(screen.getAllByRole('heading', { name: t('en', 'importedRefunds.title') })).toHaveLength(1);
  const card = control.closest('.rounded-card');
  expect(card).not.toBeNull();
  expect(shell?.contains(card)).toBe(true);
});
