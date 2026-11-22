import type { ReactNode } from 'react';
import type { ServiceCategoryListItem, WorkspaceBusiness } from '@pospay/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  branch,
  branchCategory,
  branchId,
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
// الإطار يضيف أصناف التكديس على غلاف الجدول فقط عند تفعيل stacked؛ لا شيء مرئيًا يميّزها في jsdom.
const STACKED_TOKEN = 'max-[599.99px]:[&_table]:block';

const category: ServiceCategoryListItem = {
  id: '01920000-0000-7000-8000-0000000000a1',
  name_en: 'Hair',
  name_ar: 'Hair AR',
  visibility: 'BUSINESS',
  owner_branch_id: null,
  closed_at: null,
  revision: 1,
};

function ok(items: unknown[], cursor: string | null = null) {
  return { data: { items, next_cursor: cursor }, response: { status: 200 } };
}

function renderScreen(
  scope: 'COMPANY' | 'BRANCH',
  workspace: WorkspaceBusiness = business([branch(), secondBranch()]),
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ServiceCategoriesScreen
      companyId={companyId}
      business={workspace}
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

function follows(first: Node, second: Node) {
  return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
}

function branchReads(items: unknown[], cursor: string | null = null) {
  get.mockImplementation((path: string) =>
    Promise.resolve(path === branchListPath ? ok(items, cursor) : ok([])),
  );
}

beforeEach(() => {
  get.mockReset();
});

it('business view: header, then the scope select, then the card with filter, table and paging', async () => {
  get.mockResolvedValue(ok([category], nextCursor));
  renderScreen('COMPANY');
  const table = await screen.findByRole('table');
  const heading = screen.getByRole('heading', { level: 1, name: 'Categories' });
  const select = screen.getByLabelText('Show categories for');
  const filter = screen.getByRole('group');
  const next = screen.getByRole('button', { name: 'Next page' });
  expect(follows(heading, select)).toBe(true);
  expect(follows(select, filter)).toBe(true);
  expect(follows(filter, table)).toBe(true);
  expect(follows(table, next)).toBe(true);
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  expect(heading.closest('[data-page-shell="list"]')?.contains(table)).toBe(true);
});

it('business view: keeps the filter inside the card while empty', async () => {
  get.mockResolvedValue(ok([]));
  renderScreen('COMPANY');
  const empty = await screen.findByText('No categories on this page.');
  const card = screen.getByRole('group').closest('.rounded-card') as HTMLElement;
  expect(within(card).getByText('No categories on this page.')).toBe(empty);
  expect(screen.queryByRole('table')).toBeNull();
});

it('business view: stacked rows label every cell with content and leave the action cell bare', async () => {
  get.mockResolvedValue(ok([category]));
  renderScreen('COMPANY');
  const table = await screen.findByRole('table');
  expect(table.parentElement?.className).toContain(STACKED_TOKEN);
  const cells = within((await screen.findAllByRole('row'))[1] as HTMLElement).getAllByRole('cell');
  expect(cells.map((cell) => cell.getAttribute('data-cell-label'))).toEqual([
    null,
    'Visibility',
    'State',
    null,
  ]);
  expect(within(cells[3] as HTMLElement).getByRole('button', { name: 'Open' })).toBeTruthy();
});

it('branch view: header, then the scope select, then the card with tabs, table and paging', async () => {
  branchReads([branchCategory()], nextCursor);
  renderScreen('BRANCH');
  const table = await screen.findByRole('table');
  const heading = screen.getAllByRole('heading', { level: 1, name: 'Categories' })[0] as HTMLElement;
  const select = screen.getByLabelText('Show categories for');
  const tabs = screen.getByRole('button', { name: /In use/ });
  const next = screen.getByRole('button', { name: 'Next page' });
  expect(follows(heading, select)).toBe(true);
  expect(follows(select, tabs)).toBe(true);
  expect(follows(tabs, table)).toBe(true);
  expect(follows(table, next)).toBe(true);
  expect(get.mock.calls.some(([path]) => path === businessListPath)).toBe(false);
});

it('branch view: stacked rows label the visibility, branch marks and actions cells', async () => {
  branchReads([branchCategory({ visibility: 'BRANCH', owner_branch_id: branchId })]);
  renderScreen('BRANCH');
  const table = await screen.findByRole('table');
  expect(table.parentElement?.className).toContain(STACKED_TOKEN);
  const cells = within((await screen.findAllByRole('row'))[1] as HTMLElement).getAllByRole('cell');
  expect(cells.map((cell) => cell.getAttribute('data-cell-label'))).toEqual([
    null,
    'Visibility',
    'In this branch',
    'Actions',
  ]);
  expect(screen.getByRole('columnheader', { name: 'Actions' })).toBeTruthy();
});

it('branch view: a row without marks renders an empty, unlabelled marks cell', async () => {
  branchReads([branchCategory()]);
  renderScreen('BRANCH');
  const cells = within((await screen.findAllByRole('row'))[1] as HTMLElement).getAllByRole('cell');
  expect(cells[2]?.hasAttribute('data-cell-label')).toBe(false);
  expect(cells[2]?.childElementCount).toBe(0);
});

it('a branch membership with no active branch still shows the page heading above the message', async () => {
  renderScreen('BRANCH', business([branch({ is_active: false })]));
  const heading = await screen.findByRole('heading', { level: 1, name: 'Categories' });
  const message = screen.getByText('No active branch to show categories for.');
  expect(follows(heading, message)).toBe(true);
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  expect(get).not.toHaveBeenCalled();
});

it('keeps the very same scope select, and its focus, when it switches the view', async () => {
  get.mockResolvedValue(ok([]));
  renderScreen('COMPANY');
  await screen.findByText('No categories on this page.');
  const select = screen.getByLabelText('Show categories for');
  select.focus();
  fireEvent.change(select, { target: { value: branchId } });
  await waitFor(() => expect(screen.getByRole('button', { name: /In use/ })).toBeTruthy());
  expect(screen.getByLabelText('Show categories for')).toBe(select);
  expect(document.activeElement).toBe(select);
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
});

it('offers one create action in the header and opens the branch form from it', async () => {
  branchReads([branchCategory()]);
  renderScreen('BRANCH');
  await screen.findByRole('table');
  const heading = screen.getByRole('heading', { level: 1, name: 'Categories' });
  const create = screen.getByRole('button', { name: 'Add category' });
  expect(heading.closest('header')?.contains(create)).toBe(true);
  expect(screen.getAllByRole('button', { name: 'Add category' })).toHaveLength(1);
  fireEvent.click(create);
  expect(await screen.findByRole('form', { name: 'Add category' })).toBeTruthy();
});

it('shows the business lead and the create action only in the business view', async () => {
  get.mockResolvedValue(ok([]));
  renderScreen('COMPANY');
  await screen.findByText('No categories on this page.');
  expect(screen.getByText('Manage service categories, their visibility and their open state.')).toBeTruthy();
  const select = screen.getByLabelText('Show categories for');
  fireEvent.change(select, { target: { value: branchId } });
  await screen.findByRole('button', { name: /In use/ });
  expect(screen.queryByText('Manage service categories, their visibility and their open state.')).toBeNull();
  expect(screen.getAllByRole('button', { name: 'Add category' })).toHaveLength(1);
});
