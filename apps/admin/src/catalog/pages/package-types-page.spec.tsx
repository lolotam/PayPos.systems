import type { ReactNode } from 'react';
import type { PackageTypeListItem } from '@pospay/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { PackageTypesPage } from './package-types-page';

const get = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: get, POST: vi.fn() }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' as const }));

const companyId = '01920000-0000-7000-8000-000000000001';
const businessId = '01920000-0000-7000-8000-000000000002';
const userId = '01920000-0000-7000-8000-000000000003';
const listRoute = '/v1/businesses/{businessId}/package-types';

function item(overrides: Partial<PackageTypeListItem> = {}): PackageTypeListItem {
  return {
    id: '01920000-0000-7000-8000-0000000000a1',
    name_en: 'Bridal package',
    name_ar: null,
    price: '120.000',
    validity_days: 90,
    component_count: 3,
    revision: 1,
    selling_stopped_at: null,
    ...overrides,
  };
}

function page(items: PackageTypeListItem[], nextCursor: string | null = null, canManage = true) {
  return {
    data: { items, next_cursor: nextCursor, can_manage: canManage },
    response: { status: 200 },
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <PackageTypesPage
      companyId={companyId}
      userId={userId}
      business={{
        id: businessId,
        name_en: 'Business',
        name_ar: null,
        business_type: 'salon',
        country: null,
        branches: [],
      }}
    />,
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  );
}

beforeEach(() => {
  get.mockReset();
});

it('opens with the heading, the description and the add action in the header', async () => {
  get.mockResolvedValue(page([item()]));
  renderPage();
  const heading = await screen.findByRole('heading', { level: 1, name: 'Package types' });
  expect(heading.closest('[data-page-shell="list"]')).not.toBeNull();
  expect(screen.getByText('Packages available across all branches of this business.')).toBeTruthy();
  const action = screen.getByRole('link', { name: 'Add package type' });
  expect(action.getAttribute('href')).toBe('/catalog/package-types/create');
  expect(heading.closest('header')?.contains(action)).toBe(true);
});

it('holds the table and the paging inside one card, table first', async () => {
  get.mockResolvedValue(page([item()], '01920000-0000-7000-8000-0000000000b9'));
  renderPage();
  const table = await screen.findByRole('table');
  const card = table.closest('.rounded-card') as HTMLElement;
  const next = screen.getByRole('button', { name: 'Next page' });
  expect(next.closest('.rounded-card')).toBe(card);
  expect(table.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(within(card).getByRole('button', { name: 'First page' })).toBeTruthy();
});

it('keeps the card while loading, on error and when the page is empty', async () => {
  let resolve: (value: ReturnType<typeof page>) => void = () => undefined;
  get.mockReturnValueOnce(new Promise((done) => (resolve = done)));
  renderPage();
  const loading = await screen.findByRole('status');
  const frame = screen.getByRole('heading', { level: 2, name: 'Package types' });
  expect((frame.closest('.rounded-card') as HTMLElement).contains(loading)).toBe(true);
  expect(screen.queryByRole('button', { name: 'Next page' })).toBeNull();
  resolve(page([]));
  const empty = await screen.findByText('No package types on this page.');
  const heading = screen.getByRole('heading', { level: 2, name: 'Package types' });
  expect((heading.closest('.rounded-card') as HTMLElement).contains(empty)).toBe(true);
  expect(screen.queryByRole('table')).toBeNull();
});

it('shows the refusal inside the card when the read fails', async () => {
  get.mockResolvedValue({
    error: { code: 'FORBIDDEN', message_ar: 'Not allowed here AR', message_en: 'Not allowed here' },
    response: { status: 403 },
  });
  renderPage();
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain('Not allowed here');
  const frame = screen.getByRole('heading', { level: 2, name: 'Package types' });
  expect((frame.closest('.rounded-card') as HTMLElement).contains(alert)).toBe(true);
});

// الإطار يضيف أصناف التكديس على غلاف الجدول فقط عند تفعيل stacked؛ لا شيء مرئيًا يميّزها في jsdom.
const STACKED_CLASS = 'max-[599.99px]:[&_table]:block';

it('opts the table in to stacked rows and labels every cell that has content', async () => {
  get.mockResolvedValue(page([item({ selling_stopped_at: '2026-11-01T00:00:00Z' })]));
  renderPage();
  const table = await screen.findByRole('table');
  expect(table.parentElement?.className).toContain(STACKED_CLASS);
  const row = (await screen.findAllByRole('row'))[1] as HTMLElement;
  const cells = within(row).getAllByRole('cell');
  expect(cells.map((cell) => cell.getAttribute('data-cell-label'))).toEqual([
    null,
    'Price (KWD, 3 decimals)',
    'Validity (days)',
    'Services',
    'Selling',
    null,
  ]);
  expect(cells[0]?.textContent).toContain('Bridal package');
  expect(within(cells[5] as HTMLElement).getByRole('button', { name: 'Edit' })).toBeTruthy();
});

it('renders no label for a selling cell whose button is hidden', async () => {
  get.mockResolvedValue(page([item()], null, false));
  renderPage();
  const row = (await screen.findAllByRole('row'))[1] as HTMLElement;
  const selling = within(row).getAllByRole('cell')[4] as HTMLElement;
  expect(selling.hasAttribute('data-cell-label')).toBe(false);
  expect(selling.childElementCount).toBe(0);
  // تنكمش بصريًا تحت 600px لكنها تبقى في شجرة الإتاحة (لا hidden) كي لا تنزاح الخلايا التالية عن ترويساتها.
  expect(selling.className).toContain('max-[599.99px]:empty:py-0');
  expect(selling.className.split(' ')).not.toContain('max-[599.99px]:empty:hidden');
  expect(within(row).getAllByRole('cell')).toHaveLength(6);
  expect(within(row).queryByRole('button', { name: /selling/i })).toBeNull();
});

it('isolates the price number as left-to-right without changing the cell direction', async () => {
  get.mockResolvedValue(page([item()]));
  renderPage();
  const row = (await screen.findAllByRole('row'))[1] as HTMLElement;
  const priceCell = within(row).getAllByRole('cell')[1] as HTMLElement;
  expect(priceCell.hasAttribute('dir')).toBe(false);
  const number = within(priceCell).getByText('120.000');
  expect(number.tagName).toBe('BDI');
  expect(number.getAttribute('dir')).toBe('ltr');
});

it('keeps the edit panel below the list card', async () => {
  get.mockImplementation((path: string) =>
    Promise.resolve(
      path === listRoute
        ? page([item()])
        : {
            data: {
              ...item(),
              business_id: businessId,
              components: [],
              created_at: '2026-10-08T00:00:00Z',
              updated_at: '2026-10-08T00:00:00Z',
            },
            response: { status: 200 },
          },
    ),
  );
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  const panelTitle = await screen.findByRole('heading', { name: 'Edit package type' });
  const listCard = screen.getByRole('table').closest('.rounded-card') as HTMLElement;
  const panelCard = panelTitle.closest('.rounded-card') as HTMLElement;
  expect(panelCard).not.toBe(listCard);
  expect(
    listCard.compareDocumentPosition(panelCard) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});
