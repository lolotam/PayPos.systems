import type { ReactNode } from 'react';
import type { ServiceCategoryListItem } from '@pospay/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  branch,
  branchCategory,
  business,
  companyId,
  secondBranch,
  userId,
} from './service-categories-screen.fixtures';
import { ServiceCategoriesScreen } from './service-categories-screen';

const get = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: get }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' as const }));

const businessListPath = '/v1/businesses/{businessId}/service-categories';
const branchListPath = '/v1/businesses/{businessId}/branches/{branchId}/service-categories';

const nextCursor = JSON.stringify(['Hair', '01920000-0000-7000-8000-0000000000a1']);

const category: ServiceCategoryListItem = {
  id: '01920000-0000-7000-8000-0000000000a1',
  name_en: 'Hair',
  name_ar: 'Hair AR',
  visibility: 'BUSINESS',
  owner_branch_id: null,
  closed_at: null,
  revision: 1,
};

function ok(items: unknown[], nextCursor: string | null = null) {
  return { data: { items, next_cursor: nextCursor }, response: { status: 200 } };
}

function renderScreen(scope: 'COMPANY' | 'BRANCH') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ServiceCategoriesScreen
      companyId={companyId}
      business={business([branch(), secondBranch()])}
      userId={userId}
      scope={scope}
      rememberedBranchId={undefined}
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

it('business view: one list shell with filter tabs, table and paging in one card, in that order', async () => {
  get.mockResolvedValue(ok([category], nextCursor));
  renderScreen('COMPANY');
  const table = await screen.findByRole('table');
  const shell = table.closest('[data-page-shell="list"]') as HTMLElement;
  expect(shell.className).toContain('max-w-[1200px]');
  expect(shell.querySelectorAll('[data-page-shell]')).toHaveLength(0);
  const card = table.closest('.rounded-card') as HTMLElement;
  const filter = within(card).getByRole('group');
  const next = within(card).getByRole('button', { name: 'Next page' });
  expect(filter.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(table.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByRole('heading', { level: 1, name: 'Categories' })).toBeTruthy();
  const create = screen.getByRole('button', { name: 'Add category' });
  expect(create.closest('header')?.querySelector('.ms-auto')).not.toBeNull();
});

it('business view: keeps the filter inside the card while loading and when empty', async () => {
  get.mockResolvedValue(ok([]));
  renderScreen('COMPANY');
  const empty = await screen.findByText('No categories on this page.');
  const card = screen.getByRole('group').closest('.rounded-card') as HTMLElement;
  expect(within(card).getByText('No categories on this page.')).toBe(empty);
  expect(screen.queryByRole('table')).toBeNull();
});

it('business view: stacked rows label every cell after the first', async () => {
  get.mockResolvedValue(ok([category]));
  renderScreen('COMPANY');
  const row = (await screen.findAllByRole('row'))[1] as HTMLElement;
  const cells = within(row).getAllByRole('cell');
  expect(cells[0]?.hasAttribute('data-cell-label')).toBe(false);
  expect(cells.slice(1).map((cell) => cell.getAttribute('data-cell-label'))).toEqual([
    'Visibility',
    'State',
    'Open',
  ]);
});

it('branch view: header, filter tabs, table and paging sit in the same list shell', async () => {
  get.mockImplementation((path: string) =>
    Promise.resolve(
      path === branchListPath
        ? ok([branchCategory()], nextCursor)
        : ok([]),
    ),
  );
  renderScreen('BRANCH');
  const table = await screen.findByRole('table');
  const shell = table.closest('[data-page-shell="list"]') as HTMLElement;
  const card = table.closest('.rounded-card') as HTMLElement;
  const heading = within(shell).getAllByRole('heading', { level: 1, name: 'Categories' });
  expect(heading.length).toBeGreaterThan(0);
  const tabs = within(card).getByRole('button', { name: /In use/ });
  expect(tabs.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(within(card).getByRole('button', { name: 'Next page' })).toBeTruthy();
  expect(get.mock.calls.some(([path]) => path === businessListPath)).toBe(false);
});

it('branch view: stacked rows label the visibility and in-this-branch cells', async () => {
  get.mockImplementation((path: string) =>
    Promise.resolve(path === branchListPath ? ok([branchCategory()]) : ok([])),
  );
  renderScreen('BRANCH');
  const row = (await screen.findAllByRole('row'))[1] as HTMLElement;
  const cells = within(row).getAllByRole('cell');
  expect(cells[0]?.hasAttribute('data-cell-label')).toBe(false);
  expect(cells[1]?.getAttribute('data-cell-label')).toBe('Visibility');
  expect(cells[2]?.getAttribute('data-cell-label')).toBe('In this branch');
});
