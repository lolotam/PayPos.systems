import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CreateServicePage } from './create-service-page';

const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: get, POST: post }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' as const }));

const companyId = '01920000-0000-7000-8000-000000000001';
const businessId = '01920000-0000-7000-8000-000000000002';
const userId = '01920000-0000-7000-8000-000000000003';
const listRoute = '/v1/businesses/{businessId}/service-categories';
const createRoute = '/v1/businesses/{businessId}/services';

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <div dir="rtl">{children}</div>
    </QueryClientProvider>
  );
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <CreateServicePage
      companyId={companyId}
      business={{
        id: businessId,
        name_en: 'Business',
        name_ar: null,
        business_type: 'salon',
        country: null,
        branches: [],
      }}
      userId={userId}
    />,
    { wrapper: wrapper(client) },
  );
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  get.mockResolvedValue({ data: { items: [], next_cursor: null }, response: { status: 200 } });
});

it('lays the form on the 840px shell with all fields and the save action in one card', async () => {
  renderPage();
  const shell = await screen.findByRole('heading', { name: 'Add service' });
  const page = shell.closest('[data-page-shell="form"]') as HTMLElement;
  expect(page.className).toContain('max-w-[840px]');
  expect(page.className).toContain('mx-auto');

  const save = screen.getByRole('button', { name: 'Add service' });
  const card = save.closest('.rounded-card') as HTMLElement;
  expect(card).not.toBeNull();
  const english = within(card).getByLabelText('English name');
  const inputs = within(card).getAllByRole('textbox');
  expect(inputs.length).toBeGreaterThanOrEqual(2);
  inputs.forEach((input) => {
    expect(input.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  expect(english).toBeTruthy();
});

it('saves through the same path and reports the created service', async () => {
  post.mockResolvedValue({
    data: {
      id: '01920000-0000-7000-8000-0000000000c1',
      business_id: businessId,
      name_en: 'New service',
      name_ar: null,
      price: '10.000',
      commission_rule: { kind: 'FOLLOW_PLAN' },
      counts_toward_threshold: true,
      duration_minutes: null,
      category_id: null,
      category: null,
      closed_at: null,
      revision: 1,
      created_at: '2026-11-22T10:00:00Z',
      updated_at: '2026-11-22T10:00:00Z',
    },
    response: { status: 201 },
  });
  renderPage();
  fireEvent.change(await screen.findByLabelText('English name'), {
    target: { value: 'New service' },
  });
  fireEvent.change(screen.getByLabelText('Price (KWD, 3 decimals)'), {
    target: { value: '10.000' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add service' }));
  await waitFor(() => expect(post).toHaveBeenCalled());
  expect((await screen.findByRole('status')).textContent).toContain('Service created:');
});

it('keeps the validation message when the form is incomplete', async () => {
  renderPage();
  await screen.findByLabelText('English name');
  fireEvent.click(screen.getByRole('button', { name: 'Add service' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(post).not.toHaveBeenCalled();
});

it('refuses no list route other than the categories read', async () => {
  renderPage();
  await screen.findByLabelText('English name');
  expect(get.mock.calls.map((call) => call[0])).toEqual([listRoute]);
  expect(get.mock.calls.map((call) => call[0])).not.toContain(createRoute);
});
