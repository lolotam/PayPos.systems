import { DirectionProvider } from '@pospay/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { SessionServiceScope } from '../api/use-session-services';
import { usePackageRouteSelection } from '../model/use-package-route-selection';
import { CustomerPackagesPage } from './customer-packages-page';

function TestPage({ scope, customerId }: { scope: SessionServiceScope; customerId: string }) {
  const selection = usePackageRouteSelection('layout');
  return <CustomerPackagesPage scope={scope} customerId={customerId} selection={selection} />;
}

const api = vi.hoisted(() => ({ GET: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}));

const customerId = '01920000-0000-7000-8000-0000000000f1';
const scope: SessionServiceScope = {
  companyId: '01920000-0000-7000-8000-000000000101',
  businessId: '01920000-0000-7000-8000-000000000102',
  branchId: '01920000-0000-7000-8000-000000000103',
  userId: 'user',
};

function item(id: string, name: string) {
  return {
    id,
    provenance: 'SOLD',
    name_en: name,
    name_ar: null,
    expires_on: '2026-12-01',
    expired: false,
    used_up: false,
    price_paid: '36.000',
    refunded_amount: '0.000',
    components: [
      {
        id: '01920000-0000-7000-8000-0000000001c1',
        service_id: '01920000-0000-7000-8000-0000000001c2',
        position: 1,
        name_en: 'Haircut',
        name_ar: null,
        sessions_total: 4,
        remaining: 2,
        used: 1,
        refunded: 1,
        next_unit_value: '9.000',
        slot_values: [{ unit_value: '9.000', free: 2, used: 1, refunded: 1 }],
      },
    ],
  };
}

function renderPage(id = customerId) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DirectionProvider dir="ltr">
        <TestPage scope={scope} customerId={id} />
      </DirectionProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.GET.mockReset();
});

it('centres the page on the list shell under one header', async () => {
  api.GET.mockResolvedValue({
    data: { items: [item('01920000-0000-7000-8000-0000000000a1', 'Gold')], next_cursor: null },
    response: { status: 200 },
  });
  renderPage();
  const heading = screen.getByRole('heading', { level: 1, name: "Customer's packages" });
  const shell = heading.closest('[data-page-shell="list"]') as HTMLElement;
  await screen.findByText('Gold');
  expect(shell.contains(screen.getByText('Gold'))).toBe(true);
});

it('holds the packages and the load-more action inside one card, in that order', async () => {
  api.GET.mockResolvedValue({
    data: { items: [item('01920000-0000-7000-8000-0000000000a1', 'Gold')], next_cursor: 'c2' },
    response: { status: 200 },
  });
  renderPage();
  const gold = await screen.findByText('Gold');
  const more = screen.getByRole('button', { name: 'More packages' });
  const card = more.closest('.rounded-card') as HTMLElement;
  expect(card.contains(gold)).toBe(true);
  expect(gold.compareDocumentPosition(more) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('keeps the empty state inside a card of the shell, below the header', async () => {
  api.GET.mockResolvedValueOnce({ data: { items: [], next_cursor: null }, response: { status: 200 } });
  renderPage();
  const empty = await screen.findByText('This customer has no packages.');
  const card = empty.closest('.rounded-card') as HTMLElement;
  const heading = screen.getByRole('heading', { level: 1 });
  expect(card.closest('[data-page-shell="list"]')).not.toBeNull();
  expect(heading.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('renders the unreadable-customer message outside any list card and sends no request', () => {
  renderPage('not-a-customer');
  const alert = screen.getByRole('alert');
  expect(alert.closest('.rounded-card')).toBeNull();
  expect(api.GET).not.toHaveBeenCalled();
});
