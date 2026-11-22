import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
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

it('lays the sale form on the 840px shell with the header above one card', async () => {
  renderPage();
  const heading = await screen.findByRole('heading', { level: 1, name: 'Sell a package' });
  const shell = heading.closest('[data-page-shell="form"]') as HTMLElement;
  expect(shell.className).toContain('max-w-[840px]');
  expect(shell.className).toContain('mx-auto');
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
  await waitFor(() => expect(card.contains(pending)).toBe(false));
  expect(card.compareDocumentPosition(pending) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
