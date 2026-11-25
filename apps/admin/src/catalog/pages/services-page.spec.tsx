import type { ReactNode } from 'react';
import type { ServiceListItem } from '@pospay/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { t } from '@pospay/i18n';
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

function listItem(): ServiceListItem {
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
    closed_at: null,
    revision: 1,
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

function renderPage() {
  const client = createQueryClient();
  render(
    <ServicesPage
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
  return client;
}

function categoriesResponse() {
  return { data: { items: [], next_cursor: null }, response: { status: 200 } };
}

function listResponse(items: ServiceListItem[]) {
  return { data: { items, next_cursor: null }, response: { status: 200 } };
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
});

it('holds the filter, the table and the paging inside one card, in that order', async () => {
  get.mockImplementation((path: string) =>
    path === listRoute ? Promise.resolve(listResponse([listItem()])) : categoriesResponse(),
  );
  renderPage();

  const filter = await screen.findByRole('combobox', { name: 'Filter by category' });
  const table = await screen.findByRole('table');
  const nextPage = await screen.findByRole('button', { name: 'Next page' });
  const card = filter.closest('.rounded-card');
  expect(card).not.toBeNull();
  expect(table.closest('.rounded-card')).toBe(card);
  expect(nextPage.closest('.rounded-card')).toBe(card);
  const cardElement = card as HTMLElement;
  expect(filter.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(table.compareDocumentPosition(nextPage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(within(cardElement).getByRole('heading', { name: 'Services', level: 2 })).toBeTruthy();
});

it('shows the header with title, lead and the Add service action at the inline end', async () => {
  get.mockImplementation((path: string) =>
    path === listRoute ? Promise.resolve(listResponse([listItem()])) : categoriesResponse(),
  );
  renderPage();
  expect(screen.getByRole('heading', { name: 'Services', level: 1 }).className).toContain(
    'text-2xl',
  );
  const lead = screen.getByText(/The business menu/);
  expect(lead.className).toContain('text-muted-foreground');
  const action = await screen.findByRole('link', { name: 'Add service' });
  expect(action.getAttribute('href')).toBe('/catalog/create');
  expect(action.closest('.ms-auto')).not.toBeNull();
});

it('keeps the filter visible while the list is loading and on error', async () => {
  let release: ((value: unknown) => void) | undefined;
  get.mockImplementation((path: string) => {
    if (path === listRoute) {
      return new Promise((resolve) => {
        release = resolve;
      });
    }
    return categoriesResponse();
  });
  renderPage();
  const filter = await screen.findByRole('combobox', { name: 'Filter by category' });
  expect(screen.getByRole('status').textContent).toBe('Loading');
  expect(filter).toBeTruthy();

  release?.({ error: { code: 'INTERNAL_ERROR' }, response: { status: 500 } });
  const alert = await screen.findByRole('alert');
  expect(alert.textContent.length).toBeGreaterThan(0);
  expect(screen.getByRole('combobox', { name: 'Filter by category' })).toBeTruthy();
});

it('shows the empty message inside the card while the filter stays visible', async () => {
  get.mockImplementation((path: string) =>
    path === listRoute ? Promise.resolve(listResponse([])) : categoriesResponse(),
  );
  renderPage();
  await screen.findByText('No services on this page.');
  expect(screen.getByRole('combobox', { name: 'Filter by category' })).toBeTruthy();
  expect(screen.queryByRole('table')).toBeNull();
});

it('opts the table in to stacked rows: first cell bare, other cells labelled', async () => {
  get.mockImplementation((path: string) =>
    path === listRoute ? Promise.resolve(listResponse([listItem()])) : categoriesResponse(),
  );
  renderPage();
  const row = await screen.findByRole('row', { name: /Hair cut/ });
  const cells = row.querySelectorAll('td');
  expect(cells[0]?.hasAttribute('data-cell-label')).toBe(false);
  expect(cells[0]?.textContent).toContain('Hair cut');
  expect(cells[1]?.getAttribute('data-cell-label')).toBe('Price (KWD, 3 decimals)');
  expect(cells[3]?.getAttribute('data-cell-label')).toBe('Category');
});

it('keeps the edit panel below the list card', async () => {
  get.mockImplementation((path: string) => {
    if (path === listRoute) return Promise.resolve(listResponse([listItem()]));
    if (path === '/v1/businesses/{businessId}/services/{serviceId}') {
      return Promise.resolve({
        data: {
          id: serviceId,
          business_id: businessId,
          name_en: 'Hair cut',
          name_ar: null,
          price: '12.500',
          commission_rule: { kind: 'FOLLOW_PLAN' },
          counts_toward_threshold: true,
          duration_minutes: 90,
          category_id: null,
          category: null,
          closed_at: null,
          revision: 1,
          created_at: '2026-10-01T10:00:00Z',
          updated_at: '2026-10-01T10:00:00Z',
        },
        response: { status: 200 },
      });
    }
    return categoriesResponse();
  });
  renderPage();
  const row = await screen.findByRole('row', { name: /Hair cut/ });
  const edit = within(row).getByRole('button', { name: 'Edit' });
  edit.click();
  const saveChanges = await screen.findByRole('button', { name: 'Save changes' });
  const listCard = screen.getByRole('table').closest('.rounded-card');
  const panelCard = saveChanges.closest('.rounded-card');
  expect(panelCard).not.toBeNull();
  expect(panelCard).not.toBe(listCard);
  expect(
    (listCard as HTMLElement).compareDocumentPosition(panelCard as HTMLElement) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

it('links to the import page next to the Add service action', async () => {
  get.mockImplementation((path: string) =>
    path === listRoute ? Promise.resolve(listResponse([listItem()])) : categoriesResponse(),
  );
  renderPage();
  const importLink = await screen.findByRole('link', {
    name: t('en', 'catalogServiceImport.importLink'),
  });
  expect(importLink.getAttribute('href')).toBe('/catalog/import');
  const create = screen.getByRole('link', { name: 'Add service' });
  expect(create.getAttribute('href')).toBe('/catalog/create');
});
