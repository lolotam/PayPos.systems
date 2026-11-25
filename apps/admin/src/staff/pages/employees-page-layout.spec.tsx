import { act, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { EmployeesPage } from './employees-page';

const state = vi.hoisted(() => ({ useEmployees: vi.fn() }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
vi.mock('../api/use-employees', () => ({
  useEmployees: (...args: unknown[]) => state.useEmployees(...args),
}));
vi.mock('../api/use-employee-numbering', () => ({
  useEmployeeNumbering: () => ({ data: undefined }),
  useSetEmployeeNumberStart: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
}));
vi.mock('../api/use-passkeys', () => ({
  usePasskeyEmployees: () => ({
    isFetchedAfterMount: true,
    data: { items: [], next_cursor: null },
  }),
}));
vi.mock('../ui/employee-app-link-button', () => ({ EmployeeAppLinkButton: () => null }));

const id = '01920000-0000-7000-8000-0000000000a2';
const business = {
  id,
  name_en: 'Synthetic salon',
  name_ar: null,
  business_type: 'salon' as const,
  country: null,
  vertical_type: 'salon' as const,
  timezone: 'Asia/Kuwait',
  branches: [
    {
      id,
      name_ar: null,
      name_en: 'Synthetic primary',
      effective_timezone: 'Asia/Kuwait',
      is_active: true,
    },
  ],
};
const employee = {
  id,
  name_en: 'Synthetic employee',
  name_ar: null,
  role_code: 'staff',
  hire_date: '2026-01-01',
  primary_branch_id: id,
  employee_number: 3,
};
// الإطار يضيف أصناف التكديس على غلاف الجدول فقط عند تفعيل stacked؛ لا شيء مرئيًا يميّزها في jsdom.
const STACKED_CLASS = 'max-[599.99px]:[&_table]:block';

function listed(nextCursor: string | null = null) {
  return { isPending: false, isError: false, data: { items: [employee], next_cursor: nextCursor } };
}

function follows(first: Node, second: Node) {
  return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
}

function page() {
  return <EmployeesPage companyId={id} business={business} userId={id} />;
}

beforeEach(() => {
  state.useEmployees.mockReset();
});

it('puts the actions in the header, the primary one last', () => {
  state.useEmployees.mockReturnValue(listed());
  render(page());
  const heading = screen.getByRole('heading', { level: 1, name: 'Employees' });
  const header = heading.closest('header') as HTMLElement;
  expect(heading.closest('[data-page-shell="list"]')).not.toBeNull();
  expect(screen.getByText('Manage employee records and working branches.')).toBeTruthy();
  const secondary = within(header).getByRole('link', { name: 'Document types' });
  const primary = within(header).getByRole('link', { name: 'Create employee' });
  expect(primary.getAttribute('href')).toBe('/staff/create');
  expect(follows(secondary, primary)).toBe(true);
});

it('holds the search, the table and the paging inside one card, in that order', () => {
  state.useEmployees.mockReturnValue(listed('01920000-0000-7000-8000-0000000000a3'));
  render(page());
  const table = screen.getByRole('table');
  const card = table.closest('.rounded-card') as HTMLElement;
  const search = within(card).getByRole('searchbox', { name: 'Search by name or number' });
  const next = within(card).getByRole('button', { name: 'Next page' });
  expect(follows(search, table)).toBe(true);
  expect(follows(table, next)).toBe(true);
  expect(screen.getAllByRole('searchbox')).toHaveLength(1);
});

it('keeps the very same search box, and its focus, from loading through a refusal', () => {
  state.useEmployees.mockReturnValue({ isPending: true, isError: false, data: undefined });
  const view = render(page());
  const box = screen.getByRole('searchbox');
  act(() => box.focus());
  const card = box.closest('.rounded-card') as HTMLElement;
  expect(within(card).getByRole('status')).toBeTruthy();
  state.useEmployees.mockReturnValue({
    isPending: false,
    isError: true,
    error: { message_en: 'Synthetic refusal', message_ar: 'Synthetic refusal ar' },
    data: undefined,
  });
  view.rerender(page());
  expect(screen.getByRole('searchbox')).toBe(box);
  expect(document.activeElement).toBe(box);
  expect(within(card).getByRole('alert').textContent).toContain('Synthetic refusal');
  expect(screen.queryByRole('button', { name: 'Next page' })).toBeNull();
});

it('shows the empty message inside the card and keeps the paging', () => {
  state.useEmployees.mockReturnValue({
    isPending: false,
    isError: false,
    data: { items: [], next_cursor: null },
  });
  render(page());
  const card = screen
    .getByRole('heading', { level: 2, name: 'Employees' })
    .closest('.rounded-card') as HTMLElement;
  expect(within(card).getByText('No employees on this page.')).toBeTruthy();
  expect(within(card).getByRole('searchbox')).toBeTruthy();
  expect(within(card).getByRole('button', { name: 'First page' })).toBeTruthy();
  expect(screen.queryByRole('table')).toBeNull();
});

it('stacks the rows under 600px and labels every cell that has content', () => {
  state.useEmployees.mockReturnValue(listed());
  render(page());
  expect(screen.getByRole('table').parentElement?.className).toContain(STACKED_CLASS);
  const row = screen.getAllByRole('row')[1] as HTMLElement;
  const cells = within(row).getAllByRole('cell');
  expect(cells.map((cell) => cell.getAttribute('data-cell-label'))).toEqual([
    null,
    'Name',
    'Role',
    'Primary branch',
    null,
  ]);
  expect(cells[0]?.textContent).toBe('3');
  expect(within(cells[4] as HTMLElement).getByRole('link', { name: 'Edit' })).toBeTruthy();
});
