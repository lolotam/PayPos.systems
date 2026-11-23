import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  choosePackageSaleCustomer,
  choosePackageSaleTypeAndSeller,
  packageSaleScope,
  resetPackageSaleFormTest,
  submitPackageSale,
} from '../ui/package-sale-status.fixture';
import { PackageSalePage } from './package-sale-page';

const state = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  locale: 'en' as 'ar' | 'en',
  outcome: 'pending' as 'pending' | 'completed' | 'failed',
  sellerFailures: 0,
  recorderIds: null as string[] | null,
  sellerIds: null as string[] | null,
  sellerPages: null as Record<string, string[]> | null,
  entryScope: 'BRANCH' as 'COMPANY' | 'BUSINESS' | 'BRANCH' | null,
  contextAnchor: '2026-10-01T08:00:00.000Z',
}));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: state.get, POST: state.post }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));

beforeEach(() => resetPackageSaleFormTest(state));

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <PackageSalePage scope={packageSaleScope} />
    </QueryClientProvider>,
  );
}

it('lays the sale form out as a header above one card', async () => {
  renderPage();
  const heading = await screen.findByRole('heading', { level: 1, name: 'Sell a package' });
  expect(heading.closest('[data-page-shell="form"]')).not.toBeNull();
  const submit = await screen.findByRole('button', { name: 'Sell package' });
  const card = submit.closest('.rounded-card') as HTMLElement;
  expect(card).not.toBeNull();
  expect(
    heading.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

it('keeps the fields in the card and the sell action last at the card foot', async () => {
  renderPage();
  const submit = await screen.findByRole('button', { name: 'Sell package' });
  const card = submit.closest('.rounded-card') as HTMLElement;
  const price = await within(card).findByLabelText('Price paid (KWD)');
  expect(price.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const controls = within(card).getAllByRole('button');
  expect(controls[controls.length - 1]).toBe(submit);
});

it('shows the sale result below the card, never inside the action foot', async () => {
  renderPage();
  await choosePackageSaleCustomer(state);
  await choosePackageSaleTypeAndSeller(state);
  const submit = screen.getByRole('button', { name: 'Sell package' });
  const card = submit.closest('.rounded-card') as HTMLElement;
  await submitPackageSale(state);
  const pending = await screen.findByText('Processing');
  expect(card.contains(pending)).toBe(false);
  expect(card.compareDocumentPosition(pending) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('groups the fields into a Package section and a Payment section, in that order', async () => {
  renderPage();
  const submit = await screen.findByRole('button', { name: 'Sell package' });
  const card = submit.closest('.rounded-card') as HTMLElement;
  const packageTitle = within(card).getByRole('heading', { level: 2, name: 'Package' });
  const paymentTitle = within(card).getByRole('heading', { level: 2, name: 'Payment' });
  const type = within(card).getByRole('radiogroup', { name: 'Package type' });
  const price = await within(card).findByLabelText('Price paid (KWD)');
  const order = [packageTitle, type, paymentTitle, price, submit];
  order.slice(1).forEach((node, index) => {
    expect((order[index] as HTMLElement).compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

it('puts each payment field, with its label, on its own 4-column cell of the 12-column grid', async () => {
  renderPage();
  const price = await screen.findByLabelText('Price paid (KWD)');
  const method = screen.getByLabelText('Payment method');
  const seller = screen.getByLabelText('Seller employee');
  const grid = price.closest('fieldset') as HTMLElement;
  expect(grid.className).toContain('grid-cols-12');
  for (const field of [price, method, seller]) {
    const cell = field.parentElement as HTMLElement;
    expect(cell.className).toContain('md:col-span-4');
    expect(cell.querySelector('label')?.getAttribute('for')).toBe(field.id);
    expect(grid.contains(cell)).toBe(true);
  }
});
