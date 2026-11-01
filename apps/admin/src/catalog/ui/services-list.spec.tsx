import type { ReactNode } from 'react';
import type { ServiceCategoryListItem, ServiceListItem } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ServicesPage } from '../pages/services-page';
import { ServiceCategoryFilter } from './service-category-filter';

const get = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: get }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const companyId = '01920000-0000-7000-8000-000000000001';
const businessId = '01920000-0000-7000-8000-000000000002';
const userId = '01920000-0000-7000-8000-000000000003';
const closedCategoryId = '01920000-0000-7000-8000-0000000000c1';
const openCategory: ServiceCategoryListItem = {
  id: '01920000-0000-7000-8000-0000000000c2',
  name_en: 'Hair',
  name_ar: 'Hair AR',
  visibility: 'BUSINESS',
  owner_branch_id: null,
  closed_at: null,
  revision: 1,
};

function serviceRecord(overrides: Partial<ServiceListItem> = {}): ServiceListItem {
  return {
    id: '01920000-0000-7000-8000-0000000000a1',
    name_en: 'First service',
    name_ar: null,
    price: '12.500',
    commission_rule: { kind: 'FOLLOW_PLAN' },
    counts_toward_threshold: true,
    duration_minutes: 90,
    category_id: closedCategoryId,
    category: {
      name_en: 'Legacy',
      name_ar: 'Legacy AR',
      closed_at: '2026-10-05T10:00:00Z',
    },
    revision: 1,
    ...overrides,
  };
}

const firstService = serviceRecord();
const secondService = serviceRecord({
  id: '01920000-0000-7000-8000-0000000000a2',
  name_en: 'Second service',
  duration_minutes: null,
  category_id: null,
  category: null,
});
const filteredService = serviceRecord({
  id: '01920000-0000-7000-8000-0000000000a3',
  name_en: 'Filtered service',
  duration_minutes: 30,
  category_id: openCategory.id,
  category: { name_en: openCategory.name_en, name_ar: openCategory.name_ar, closed_at: null },
});

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function renderPage(client: QueryClient = createQueryClient()) {
  return render(
    <ServicesPage
      companyId={companyId}
      business={{ id: businessId, name_en: 'Business', name_ar: null, branches: [] }}
      userId={userId}
    />,
    { wrapper: wrapper(client) },
  );
}

beforeEach(() => get.mockReset());

it('renders duration and category cells with a closed mark and dashes for missing values', async () => {
  get.mockImplementation((path: string) => {
    if (path === '/v1/businesses/{businessId}/service-categories') {
      return Promise.resolve({
        data: { items: [openCategory], next_cursor: null },
        response: { status: 200 },
      });
    }
    return Promise.resolve({
      data: { items: [firstService, secondService], next_cursor: null },
      response: { status: 200 },
    });
  });
  renderPage();
  const firstRow = await screen.findByRole('row', { name: /First service/ });
  expect(within(firstRow).getByText('90')).toBeTruthy();
  expect(within(firstRow).getByText(t('en', 'catalogServices.minutesShort'))).toBeTruthy();
  expect(within(firstRow).getByText(/Legacy/).textContent).toContain(
    t('en', 'catalogServices.categoryClosed'),
  );
  const secondRow = screen.getByRole('row', { name: /Second service/ });
  expect(within(secondRow).getAllByText('—')).toHaveLength(2);
  expect(
    screen.getByRole('columnheader', { name: t('en', 'catalogServices.durationColumn') }),
  ).toBeTruthy();
  expect(
    screen.getByRole('columnheader', { name: t('en', 'catalogServices.categoryColumn') }),
  ).toBeTruthy();
});

it('hides the category filter after a 403 and still renders services', async () => {
  get.mockImplementation((path: string) => {
    if (path === '/v1/businesses/{businessId}/service-categories') {
      return Promise.resolve({
        error: {
          code: 'FORBIDDEN',
          message_ar: 'Forbidden AR',
          message_en: 'Forbidden',
        },
        response: { status: 403 },
      });
    }
    return Promise.resolve({
      data: { items: [firstService], next_cursor: null },
      response: { status: 200 },
    });
  });
  renderPage();
  expect(await screen.findByText('First service')).toBeTruthy();
  expect(screen.queryByLabelText(t('en', 'catalogServices.categoryFilter'))).toBeNull();
});

it('keeps a loaded category filter visible after a background refetch fails', () => {
  render(
    <ServiceCategoryFilter
      categoryQuery={{
        data: [openCategory],
        error: { status: 403 },
        isError: true,
        isPending: false,
      }}
      value={openCategory.id}
      onChange={vi.fn()}
    />,
  );
  const picker = screen.getByLabelText(
    t('en', 'catalogServices.categoryFilter'),
  ) as HTMLSelectElement;
  expect(picker.value).toBe(openCategory.id);
  expect(picker.selectedOptions[0]?.textContent).toBe('Hair');
});

function mockFilteredServicePages() {
  get.mockImplementation(
    (
      path: string,
      options?: { params?: { query?: { cursor?: string; category_id?: string } } },
    ) => {
      if (path === '/v1/businesses/{businessId}/service-categories') {
        return Promise.resolve({
          data: { items: [openCategory], next_cursor: null },
          response: { status: 200 },
        });
      }
      if (path !== '/v1/businesses/{businessId}/services') {
        return Promise.resolve({
          error: {
            code: 'UNEXPECTED_PATH',
            message_ar: 'Unexpected AR',
            message_en: `Unexpected path: ${path}`,
          },
          response: { status: 500 },
        });
      }
      const query = options?.params?.query;
      if (query?.category_id === openCategory.id) {
        return Promise.resolve({
          data: { items: [filteredService], next_cursor: null },
          response: { status: 200 },
        });
      }
      if (query?.cursor === secondService.id) {
        return Promise.resolve({
          data: { items: [secondService], next_cursor: null },
          response: { status: 200 },
        });
      }
      return Promise.resolve({
        data: { items: [firstService], next_cursor: secondService.id },
        response: { status: 200 },
      });
    },
  );
}

it('filters visible rows by category and resets the cursor to the first page', async () => {
  mockFilteredServicePages();
  renderPage();
  expect(await screen.findByText('First service')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'catalogServices.next') }));
  expect(await screen.findByText('Second service')).toBeTruthy();
  fireEvent.change(screen.getByLabelText(t('en', 'catalogServices.categoryFilter')), {
    target: { value: openCategory.id },
  });
  expect(await screen.findByText('Filtered service')).toBeTruthy();
  expect(screen.queryByText('First service')).toBeNull();
  expect(screen.queryByText('Second service')).toBeNull();
  expect(
    (screen.getByRole('button', { name: t('en', 'catalogServices.first') }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  await waitFor(() => {
    const serviceCalls = get.mock.calls.filter(
      ([path]) => path === '/v1/businesses/{businessId}/services',
    );
    expect(serviceCalls.at(-1)?.[1]?.params?.query).toEqual({
      limit: 20,
      category_id: openCategory.id,
    });
  });
});

function lastServicesQuery() {
  const serviceCalls = get.mock.calls.filter(
    ([path]) => path === '/v1/businesses/{businessId}/services',
  );
  return serviceCalls.at(-1)?.[1]?.params?.query;
}

it('drops a selected category when the open category list no longer contains it', async () => {
  const filterLabel = t('en', 'catalogServices.categoryFilter');
  const allCategoriesLabel = t('en', 'catalogServices.allCategories');
  let categoriesEmpty = false;
  get.mockImplementation((path: string) => {
    if (path === '/v1/businesses/{businessId}/service-categories') {
      return Promise.resolve({
        data: { items: categoriesEmpty ? [] : [openCategory], next_cursor: null },
        response: { status: 200 },
      });
    }
    return Promise.resolve({
      data: { items: [firstService], next_cursor: null },
      response: { status: 200 },
    });
  });
  const client = createQueryClient();
  renderPage(client);
  await screen.findByRole('option', { name: openCategory.name_en });
  const picker = (await screen.findByLabelText(filterLabel)) as HTMLSelectElement;
  fireEvent.change(picker, { target: { value: openCategory.id } });
  await waitFor(() => {
    expect(lastServicesQuery()).toEqual({ limit: 20, category_id: openCategory.id });
  });
  await act(async () => {
    categoriesEmpty = true;
    await client.invalidateQueries({ queryKey: ['service-categories'] });
  });
  await waitFor(() => {
    const current = screen.getByLabelText(filterLabel) as HTMLSelectElement;
    expect(current.value).toBe('');
    expect(current.selectedOptions[0]?.textContent).toBe(allCategoriesLabel);
  });
  await waitFor(() => {
    expect(lastServicesQuery()).toEqual({ limit: 20 });
  });
});
