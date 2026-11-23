import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { DocumentTypesPage } from './document-types-page';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' as const }));

const id = '01920000-0000-7000-8000-0000000000a2';
const civil = {
  id,
  code: 'civil_id',
  name_en: 'Civil ID',
  name_ar: null,
  alert_days: 30,
  requires_expiry: true,
  active: true,
  revision: 2,
};
// الإطار يضيف أصناف التكديس على غلاف الجدول فقط عند تفعيل stacked؛ لا شيء مرئيًا يميّزها في jsdom.
const STACKED_CLASS = 'max-[599.99px]:[&_table]:block';

function follows(first: Node, second: Node) {
  return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
}

function renderPage() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <DocumentTypesPage companyId={id} userId={id} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.GET.mockReset().mockResolvedValue({ data: { items: [civil] } });
});

it('opens as a list page with the heading and the description', async () => {
  renderPage();
  await screen.findByRole('table');
  const heading = screen.getByRole('heading', { level: 1, name: 'Document types' });
  expect(heading.closest('[data-page-shell="list"]')).not.toBeNull();
  expect(
    screen.getByText(
      'Types apply to the whole company. Deactivating a type keeps its recorded documents.',
    ),
  ).toBeTruthy();
});

it('holds the table in one card and puts the add form after it, below the card', async () => {
  renderPage();
  const table = await screen.findByRole('table');
  const card = table.closest('.rounded-card') as HTMLElement;
  const add = screen.getByRole('button', { name: 'Add type' });
  expect(card.contains(add)).toBe(false);
  expect(follows(card, add)).toBe(true);
});

it('keeps the card while loading and when the read fails', async () => {
  api.GET.mockReturnValue(new Promise(() => undefined));
  renderPage();
  const card = screen
    .getByRole('heading', { level: 2, name: 'Document types' })
    .closest('.rounded-card') as HTMLElement;
  expect(card.contains(screen.getByRole('status'))).toBe(true);
  expect(screen.queryByRole('button', { name: 'Add type' })).toBeNull();
});

it('stacks the rows under 600px, labelling every cell but the name and the actions', async () => {
  renderPage();
  const table = await screen.findByRole('table');
  expect(table.parentElement?.className).toContain(STACKED_CLASS);
  const row = screen.getAllByRole('row')[1] as HTMLElement;
  const cells = within(row).getAllByRole('cell');
  expect(cells.map((cell) => cell.getAttribute('data-cell-label'))).toEqual([
    null,
    'Alert days before expiry (0–365)',
    'Expiry date required',
    'State',
    null,
  ]);
  expect(cells[0]?.textContent).toBe('Civil ID');
  expect(within(cells[4] as HTMLElement).getByRole('button', { name: 'Edit' })).toBeTruthy();
});
