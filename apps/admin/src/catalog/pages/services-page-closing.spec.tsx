import type { ReactNode } from 'react';
import type { Service, ServiceListItem } from '@pospay/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ServicesPage } from './services-page';

const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: get, POST: post }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' as const }));

const companyId = '01920000-0000-7000-8000-000000000001';
const businessId = '01920000-0000-7000-8000-000000000002';
const userId = '01920000-0000-7000-8000-000000000003';
const serviceId = '01920000-0000-7000-8000-0000000000a1';
const listRoute = '/v1/businesses/{businessId}/services';
const categoriesRoute = '/v1/businesses/{businessId}/service-categories';
const detailRoute = '/v1/businesses/{businessId}/services/{serviceId}';

function listItem(closed: boolean): ServiceListItem {
  return {
    id: serviceId,
    name_en: 'Hair cut',
    name_ar: 'Hair cut AR',
    price: '12.500',
    commission_rule: { kind: 'FOLLOW_PLAN' },
    counts_toward_threshold: true,
    duration_minutes: 90,
    category_id: null,
    category: null,
    closed_at: closed ? '2026-11-20T10:00:00Z' : null,
    revision: closed ? 2 : 1,
  };
}

function detailRecord(closed: boolean): Service {
  return {
    id: serviceId,
    business_id: businessId,
    name_en: 'Hair cut',
    name_ar: 'Hair cut AR',
    price: '12.500',
    commission_rule: { kind: 'FOLLOW_PLAN' },
    counts_toward_threshold: true,
    duration_minutes: 90,
    category_id: null,
    category: null,
    closed_at: closed ? '2026-11-20T10:00:00Z' : null,
    revision: closed ? 2 : 1,
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:00:00Z',
  };
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <div dir="ltr">{children}</div>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
});

it('after a close the service row in the list shows the closed badge and the lists refetch', async () => {
  let listReads = 0;
  let categoryReads = 0;
  get.mockImplementation((path: string) => {
    if (path === listRoute) {
      const closed = listReads > 0;
      listReads += 1;
      return Promise.resolve({
        data: { items: [listItem(closed)], next_cursor: null },
        response: { status: 200 },
      });
    }
    if (path === categoriesRoute) {
      categoryReads += 1;
      return Promise.resolve({ data: { items: [], next_cursor: null }, response: { status: 200 } });
    }
    if (path === detailRoute) {
      return Promise.resolve({ data: detailRecord(false), response: { status: 200 } });
    }
    return Promise.resolve({ data: {}, response: { status: 200 } });
  });
  post.mockResolvedValueOnce({
    data: detailRecord(true),
    response: { status: 200 },
  });

  const client = createQueryClient();
  render(
    <ServicesPage
      companyId={companyId}
      business={{ id: businessId, name_en: 'Business', name_ar: null, branches: [] }}
      userId={userId}
    />,
    { wrapper: wrapper(client) },
  );

  const row = await screen.findByRole('row', { name: /Hair cut/ });
  expect(within(row).queryByText('Closed')).toBeNull();
  fireEvent.click(within(row).getByRole('button', { name: 'Edit' }));
  await screen.findByRole('button', { name: 'Close service' });
  const listReadsBefore = listReads;
  const categoryReadsBefore = categoryReads;
  fireEvent.click(screen.getByRole('button', { name: 'Close service' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  expect(await screen.findByRole('status').then((status) => status.textContent)).toBe(
    'Service closed.',
  );

  const closedRow = screen.getByRole('row', { name: /Hair cut/ });
  expect(within(closedRow).getByText('Closed')).toBeTruthy();
  await waitFor(() => expect(listReads).toBe(listReadsBefore + 1));
  await waitFor(() => expect(categoryReads).toBe(categoryReadsBefore + 1));
});
