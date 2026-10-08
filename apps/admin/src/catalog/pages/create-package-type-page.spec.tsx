import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { CreatePackageTypePage } from './create-package-type-page';

const post = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ POST: post }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
vi.mock('../api/use-package-services', () => ({
  usePackageServices: () => ({
    data: {
      pages: [
        {
          items: [
            {
              id: '01920000-0000-7000-8000-000000000001',
              name_en: 'Service',
              name_ar: null,
              price: '1.000',
            },
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

it('resets after successful creation so another click cannot submit the saved package', async () => {
  post.mockResolvedValueOnce({
    data: {
      id,
      business_id: id,
      name_en: 'Package',
      name_ar: null,
      price: '25.500',
      validity_days: 30,
      components: [
        { service_id: id, sessions: 10, name_en: 'Service', name_ar: null, price: '1.000' },
      ],
      revision: 1,
      created_at: '2026-10-08T00:00:00Z',
      updated_at: '2026-10-08T00:00:00Z',
    },
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
    >
      <CreatePackageTypePage
        companyId={id}
        userId={id}
        business={{ id, name_en: 'Business', name_ar: null, branches: [] }}
      />
    </QueryClientProvider>,
  );
  for (const [label, value] of [
    ['nameEn', 'Package'],
    ['price', '25.500'],
    ['validity', '30'],
    ['service', id],
    ['sessions', '10'],
  ] as const)
    fireEvent.change(screen.getByLabelText(t('en', `catalogPackageTypes.${label}`)), {
      target: { value },
    });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'catalogPackageTypes.create') }));
  await screen.findByText(`${t('en', 'catalogPackageTypes.created')} Package`);
  await waitFor(() =>
    expect(
      (screen.getByLabelText(t('en', 'catalogPackageTypes.nameEn')) as HTMLInputElement).value,
    ).toBe(''),
  );
  expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('');
  expect(
    (screen.getByLabelText(t('en', 'catalogPackageTypes.price')) as HTMLInputElement).value,
  ).toBe('0.000');
  fireEvent.click(screen.getByRole('button', { name: t('en', 'catalogPackageTypes.create') }));
  await screen.findByRole('alert');
  expect(post).toHaveBeenCalledTimes(1);
});
