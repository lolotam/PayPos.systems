import { screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  listedPage,
  noura,
  openNoura,
  renderPage,
} from './fixtures/company-employee-numbers-page.fixture';

const api = vi.hoisted(() => ({ GET: vi.fn(), PUT: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' as const }));

// الإطار يضيف أصناف التكديس على غلاف الجدول فقط عند تفعيل stacked؛ لا شيء مرئيًا يميّزها في jsdom.
const STACKED_CLASS = 'max-[599.99px]:[&_table]:block';

function follows(first: Node, second: Node) {
  return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
}

beforeEach(() => {
  noura.employee_number = 4;
  api.GET.mockReset().mockImplementation(() => Promise.resolve({ data: listedPage() }));
  api.PUT.mockReset();
});

it('opens with the heading and the description in a list page', async () => {
  renderPage();
  await screen.findByRole('table');
  const heading = screen.getByRole('heading', { level: 1, name: 'Employee numbers' });
  expect(heading.closest('[data-page-shell="list"]')).not.toBeNull();
  expect(
    screen.getByText('Every employee in the company: name, business and number.'),
  ).toBeTruthy();
});

it('holds the search, the table and the paging inside one card, in that order', async () => {
  renderPage();
  const table = await screen.findByRole('table');
  const card = table.closest('.rounded-card') as HTMLElement;
  const search = within(card).getByRole('searchbox', { name: 'Search by name or number' });
  const next = within(card).getByRole('button', { name: 'Next page' });
  expect(follows(search, table)).toBe(true);
  expect(follows(table, next)).toBe(true);
});

it('keeps the search box inside the card while the list is loading', () => {
  api.GET.mockImplementation(() => new Promise(() => undefined));
  renderPage();
  const box = screen.getByRole('searchbox');
  const card = box.closest('.rounded-card') as HTMLElement;
  expect(within(card).getByRole('status')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Next page' })).toBeNull();
});

it('shows a refusal inside the card and no search box', async () => {
  api.GET.mockImplementation(() =>
    Promise.resolve({
      error: { code: 'FORBIDDEN', message_en: 'Synthetic refusal', message_ar: 'Synthetic ar' },
      response: { status: 403 },
    }),
  );
  renderPage();
  const alert = await screen.findByRole('alert');
  const card = screen
    .getByRole('heading', { level: 2, name: 'Employee numbers' })
    .closest('.rounded-card') as HTMLElement;
  expect(card.contains(alert)).toBe(true);
  expect(screen.queryByRole('searchbox')).toBeNull();
});

it('stacks the rows under 600px and labels every cell after the name', async () => {
  renderPage();
  const table = await screen.findByRole('table');
  expect(table.parentElement?.className).toContain(STACKED_CLASS);
  const row = screen.getAllByRole('row')[2] as HTMLElement;
  const cells = within(row).getAllByRole('cell');
  expect(cells.map((cell) => cell.getAttribute('data-cell-label'))).toEqual([
    null,
    'Business',
    'Employee number',
  ]);
  expect(cells[0]?.textContent).toBe('Noura');
});

it('keeps the row editor inside the labelled number cell', async () => {
  renderPage();
  await openNoura('en');
  const row = screen.getAllByRole('row')[2] as HTMLElement;
  const numberCell = within(row).getAllByRole('cell')[2] as HTMLElement;
  expect(numberCell.getAttribute('data-cell-label')).toBe('Employee number');
  expect(within(numberCell).getByRole('textbox')).toBeTruthy();
});
