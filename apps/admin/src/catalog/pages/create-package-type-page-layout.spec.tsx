import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { CreatePackageTypePage } from './create-package-type-page';

vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ POST: vi.fn() }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' as const }));
vi.mock('../api/use-package-services', () => ({
  usePackageServices: () => ({
    data: {
      pages: [
        {
          items: [
            { id: '01920000-0000-7000-8000-0000000000f1', name_en: 'Free service', name_ar: null, price: '0.000' },
          ],
        },
      ],
    },
    isPending: false,
    isError: false,
    hasNextPage: false,
  }),
}));

const id = '01920000-0000-7000-8000-000000000001';

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CreatePackageTypePage
        companyId={id}
        userId={id}
        business={{
          id,
          name_en: 'Business',
          name_ar: null,
          business_type: 'salon',
          country: null,
          branches: [],
        }}
      />
    </QueryClientProvider>,
  );
}

it('lays the form out as one card with titled sections and the save action last at the foot', () => {
  renderPage();
  const heading = screen.getByRole('heading', { level: 1, name: 'Add package type' });
  expect(heading.closest('[data-page-shell="form"]')).not.toBeNull();
  const save = screen.getByRole('button', { name: 'Add package type' });
  const card = save.closest('.rounded-card') as HTMLElement;
  expect(card).not.toBeNull();
  expect(within(card).getByRole('heading', { level: 2, name: 'Package details' })).toBeTruthy();
  expect(within(card).getByText('Package services')).toBeTruthy();
  const controls = within(card).getAllByRole('button');
  expect(controls[controls.length - 1]).toBe(save);
  for (const label of ['English name', 'Price (KWD, 3 decimals)', 'Validity (days)']) {
    const field = within(card).getByLabelText(label);
    expect(field.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
});

it('puts the basic fields on the 12-column grid: names span 6, price and validity span 4', () => {
  renderPage();
  const span = (label: string) =>
    (screen.getByLabelText(label).parentElement as HTMLElement).className;
  expect(span('English name')).toContain('md:col-span-6');
  expect(span('Arabic name (optional)')).toContain('md:col-span-6');
  expect(span('Price (KWD, 3 decimals)')).toContain('md:col-span-4');
  expect(span('Validity (days)')).toContain('md:col-span-4');
  const grid = screen.getByLabelText('English name').parentElement?.parentElement as HTMLElement;
  expect(grid.className).toContain('grid-cols-12');
});

it('puts the service, sessions and remove controls of a row on one 12-column grid row', () => {
  renderPage();
  const service = screen.getByLabelText('Service');
  const sessions = screen.getByLabelText('Sessions');
  const remove = screen.getByRole('button', { name: 'Remove service 1' });
  const row = service.parentElement?.parentElement as HTMLElement;
  expect(row.className).toContain('grid-cols-12');
  expect(row.contains(sessions)).toBe(true);
  expect(row.contains(remove)).toBe(true);
  expect((service.parentElement as HTMLElement).className).toContain('md:col-span-6');
  expect((sessions.parentElement as HTMLElement).className).toContain('md:col-span-3');
  expect(remove.className).toContain('md:col-span-3');
});

it('keeps service, sessions and remove together and shows the free-service warning after the remove button', () => {
  renderPage();
  fireEvent.change(screen.getByLabelText('Service'), {
    target: { value: '01920000-0000-7000-8000-0000000000f1' },
  });
  const warning = screen.getByRole('status');
  const remove = screen.getByRole('button', { name: 'Remove service 1' });
  const row = (screen.getByLabelText('Service').parentElement as HTMLElement).parentElement as HTMLElement;
  expect(row.contains(warning)).toBe(true);
  expect(remove.compareDocumentPosition(warning) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const order = [screen.getByLabelText('Service'), screen.getByLabelText('Sessions'), remove];
  order.slice(1).forEach((node, index) => {
    expect((order[index] as HTMLElement).compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  expect(warning.textContent).toContain('0.000');
});
