import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { SessionServiceScope } from '../api/use-session-services';
import { usePackageRouteSelection } from '../model/use-package-route-selection';
import { CustomerPackagesPage } from './customer-packages-page';

function TestPage({ scope, customerId }: { scope: SessionServiceScope; customerId: string }) {
  const scopeKey = [scope.companyId, scope.businessId, scope.branchId, scope.userId].join(':');
  const selection = usePackageRouteSelection(scopeKey);
  return (
    <CustomerPackagesPage
      key={scopeKey}
      scope={scope}
      customerId={customerId}
      selection={selection}
    />
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const api = vi.hoisted(() => ({ GET: vi.fn() }));
const nav = vi.hoisted(() => ({
  search: '',
  push: vi.fn(),
  replace: vi.fn(),
}));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));

const companyId = '01920000-0000-7000-8000-000000000101';
const businessId = '01920000-0000-7000-8000-000000000102';
const branchId = '01920000-0000-7000-8000-000000000103';
const customerId = '01920000-0000-7000-8000-0000000000f1';
const packageA = '01920000-0000-7000-8000-0000000000a1';
const packageB = '01920000-0000-7000-8000-0000000000a2';
const scope: SessionServiceScope = { companyId, businessId, branchId, userId: 'user' };
const listPath = '/v1/businesses/{businessId}/branches/{branchId}/customers/{customerId}/packages';

function item(id: string, name_en: string, expired: boolean, used_up: boolean) {
  return {
    id,
    provenance: 'SOLD',
    name_en,
    name_ar: null,
    expires_on: '2026-12-01',
    expired,
    used_up,
    price_paid: '36.000',
    refunded_amount: '0.000',
    components: [
      {
        id: '01920000-0000-7000-8000-0000000001c1',
        service_id: '01920000-0000-7000-8000-0000000001c2',
        position: 1,
        name_en: 'Haircut',
        name_ar: null,
        sessions_total: 4,
        remaining: 2,
        used: 1,
        refunded: 1,
        next_unit_value: '9.000',
        slot_values: [{ unit_value: '9.000', free: 2, used: 1, refunded: 1 }],
      },
    ],
  };
}

function pageDetail(id: string, name_en: string, canExtend: boolean) {
  return {
    id,
    customer_id: customerId,
    package_type_id: null,
    provenance: 'SOLD',
    name_en,
    name_ar: null,
    validity_days: null,
    list_price: null,
    price_paid: '36.000',
    discount: null,
    discount_bps: null,
    paid_method: null,
    seller_employee_id: null,
    seller_linked_user_id: null,
    sold_branch_id: null,
    sold_at: null,
    sold_business_date: null,
    expires_on: '2026-12-01',
    refunded_amount: '0.000',
    revision: 1,
    can_extend: canExtend,
    components: [],
    redemptions: [],
  };
}

function preseedList(
  client: QueryClient,
  items: ReturnType<typeof item>[],
  nextCursor: string | null,
) {
  client.setQueryData(['customer-packages', companyId, businessId, branchId, 'user', customerId], {
    pages: [{ items, next_cursor: nextCursor }],
    pageParams: [undefined],
  });
}

function preseedDetail(
  client: QueryClient,
  entitlementId: string,
  name_en: string,
  canExtend: boolean,
) {
  client.setQueryData(
    ['customer-package-detail', companyId, businessId, branchId, 'user', customerId, entitlementId],
    pageDetail(entitlementId, name_en, canExtend),
  );
}

function renderPageWith(search: string, client: QueryClient) {
  nav.search = search;
  return render(
    <QueryClientProvider client={client}>
      <DirectionProvider dir="ltr">
        <TestPage scope={scope} customerId={customerId} />
      </DirectionProvider>
    </QueryClientProvider>,
  );
}

function renderPage() {
  nav.search = '';
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <DirectionProvider dir="ltr">
        <TestPage scope={scope} customerId={customerId} />
      </DirectionProvider>
    </QueryClientProvider>,
  );
  return { client, view };
}

beforeEach(() => {
  api.GET.mockReset();
  nav.push.mockReset();
  nav.replace.mockReset();
  nav.search = '';
});

it('a preseeded list stays hidden until the current authorized GET lands, and a denial keeps it hidden', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  });
  preseedList(client, [item(packageA, 'Gold', false, false)], null);
  api.GET.mockImplementation(() => new Promise(() => undefined));
  const view = renderPageWith(`?package=${packageA}`, client);
  // كاش متخزن وقراية حالية معلّقة: مفيش أي بيانات حساسة تظهر قبل الإثبات.
  await waitFor(() => expect(screen.queryByText('Gold')).toBeNull());
  expect(screen.getByRole('status').textContent).toContain(t('en', 'customerPackages.loading'));
  api.GET.mockResolvedValue({ error: { code: 'FORBIDDEN' }, response: { status: 403 } });
  await client.invalidateQueries({
    queryKey: ['customer-packages', companyId, businessId, branchId, 'user', customerId],
  });
  await screen.findByRole('alert');
  expect(screen.queryByText('Gold')).toBeNull();
  expect(screen.getByRole('alert').textContent).toContain(t('en', 'customerPackages.notAllowed'));
  // قراية حالية مصرّح بها بتظهر البيانات من جديد.
  api.GET.mockResolvedValue({
    data: { items: [item(packageA, 'Gold', false, false)], next_cursor: null },
    response: { status: 200 },
  });
  await client.invalidateQueries({
    queryKey: ['customer-packages', companyId, businessId, branchId, 'user', customerId],
  });
  await screen.findByText('Gold');
  view.unmount();
  client.clear();
});

it('a preseeded detail stays hidden while its proof is pending and after a denial', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  });
  preseedDetail(client, packageA, 'Gold', true);
  api.GET.mockImplementation((path: string) => {
    if (path === listPath)
      return Promise.resolve({
        data: { items: [item(packageA, 'Gold', false, false)], next_cursor: null },
        response: { status: 200 },
      });
    return new Promise(() => undefined);
  });
  const view = renderPageWith(`?package=${packageA}`, client);
  await screen.findByText('Gold');
  // تفصيل متخزن وقرايته الحالية معلّقة: مفيش تفاصيل ولا زر تمديد قبل الإثبات.
  expect(screen.queryByRole('button', { name: t('en', 'customerPackages.extend') })).toBeNull();
  expect(screen.queryByText(t('en', 'customerPackages.listPrice'))).toBeNull();
  api.GET.mockImplementation((path: string) => {
    if (path === listPath)
      return Promise.resolve({
        data: { items: [item(packageA, 'Gold', false, false)], next_cursor: null },
        response: { status: 200 },
      });
    return Promise.resolve({ error: { code: 'FORBIDDEN' }, response: { status: 403 } });
  });
  await client.invalidateQueries({
    queryKey: [
      'customer-package-detail',
      companyId,
      businessId,
      branchId,
      'user',
      customerId,
      packageA,
    ],
  });
  await screen.findByRole('alert');
  expect(screen.getByRole('alert').textContent).toContain(
    t('en', 'customerPackages.detailNotAllowed'),
  );
  view.unmount();
  client.clear();
});

it('a transient pagination error keeps authorized pages and retries only the next page', async () => {
  api.GET.mockResolvedValueOnce({
    data: { items: [item(packageA, 'Gold', false, false)], next_cursor: 'c2' },
    response: { status: 200 },
  })
    .mockResolvedValueOnce({ error: { code: 'UNEXPECTED' }, response: { status: 500 } })
    .mockResolvedValueOnce({
      data: { items: [item(packageB, 'Old', true, false)], next_cursor: null },
      response: { status: 200 },
    });
  renderPage();
  await screen.findByText('Gold');
  fireEvent.click(screen.getByRole('button', { name: t('en', 'customerPackages.loadMore') }));
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toContain(t('en', 'customerPackages.loadFailed')),
  );
  // الصفحات المصرّح بها بتفضل ظاهرة، والإعادة بتجلب الصفحة الجاية بس.
  expect(screen.getByText('Gold')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'customerPackages.retry') }));
  await screen.findByText('Old');
});

it('a 403 pagination error hides every page', async () => {
  api.GET.mockResolvedValueOnce({
    data: { items: [item(packageA, 'Gold', false, false)], next_cursor: 'c2' },
    response: { status: 200 },
  }).mockResolvedValue({ error: { code: 'FORBIDDEN' }, response: { status: 403 } });
  renderPage();
  await screen.findByText('Gold');
  fireEvent.click(screen.getByRole('button', { name: t('en', 'customerPackages.loadMore') }));
  await waitFor(() => expect(screen.queryByText('Gold')).toBeNull());
  expect(screen.getByRole('alert').textContent).toContain(t('en', 'customerPackages.notAllowed'));
});

it('a next-page 404 closes the selected detail and removes its controls', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.GET.mockImplementation((path: string) =>
    Promise.resolve(
      path === listPath
        ? {
            data: { items: [item(packageA, 'Gold', false, false)], next_cursor: 'c2' },
            response: { status: 200 },
          }
        : { data: pageDetail(packageA, 'Gold detail', true), response: { status: 200 } },
    ),
  );
  renderPageWith('?package=' + packageA, client);
  await screen.findByText('Gold detail');
  expect(screen.getByRole('button', { name: t('en', 'customerPackages.extend') })).toBeTruthy();
  api.GET.mockResolvedValue({ error: { code: 'NOT_FOUND' }, response: { status: 404 } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'customerPackages.loadMore') }));
  expect((await screen.findByRole('alert')).textContent).toContain(
    t('en', 'customerPackages.notFound'),
  );
  expect(screen.queryByText('Gold detail')).toBeNull();
  expect(screen.queryByRole('button', { name: t('en', 'customerPackages.extend') })).toBeNull();
});

it('hides cached pages from a failed next page until the mounted observer gets fresh access', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.GET.mockResolvedValueOnce({
    data: { items: [item(packageA, 'Gold', false, false)], next_cursor: 'c2' },
    response: { status: 200 },
  }).mockResolvedValueOnce({ error: { code: 'UNEXPECTED' }, response: { status: 500 } });
  const first = renderPageWith('', client);
  await screen.findByText('Gold');
  fireEvent.click(screen.getByRole('button', { name: t('en', 'customerPackages.loadMore') }));
  await screen.findByRole('alert');
  expect(screen.getByText('Gold')).toBeTruthy();
  first.unmount();

  const refreshing = deferred<{
    error: { code: string };
    response: { status: number };
  }>();
  api.GET.mockReturnValue(refreshing.promise);
  renderPageWith('?package=' + packageA, client);
  expect(screen.queryByText('Gold')).toBeNull();
  expect(screen.queryByRole('button', { name: t('en', 'customerPackages.extend') })).toBeNull();
  await waitFor(() => expect(api.GET).toHaveBeenCalledTimes(3));
  refreshing.resolve({ error: { code: 'FORBIDDEN' }, response: { status: 403 } });
  expect(
    (await screen.findByText(t('en', 'customerPackages.notAllowed'))).getAttribute('role'),
  ).toBe('alert');
});

it('waits for the package-list refresh before allowing another page', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const before = item(packageA, 'Gold before extension', false, false);
  const after = item(packageA, 'Gold after extension', false, false);
  const page = (pkg: typeof before) => ({
    data: { items: [pkg], next_cursor: 'c2' },
    response: { status: 200 },
  });
  api.GET.mockResolvedValueOnce(page(before));
  renderPageWith('', client);
  await screen.findByText('Gold before extension');

  const refreshing = deferred<ReturnType<typeof page>>();
  api.GET.mockReturnValue(refreshing.promise);
  const invalidated = client.invalidateQueries({
    queryKey: ['customer-packages', companyId, businessId, branchId, 'user', customerId],
  });
  const more = screen.getByRole('button', { name: t('en', 'customerPackages.loadMore') });
  await waitFor(() => expect(more).toMatchObject({ disabled: true }));
  fireEvent.click(more);
  expect(api.GET).toHaveBeenCalledTimes(2);

  refreshing.resolve(page(after));
  await invalidated;
  expect(await screen.findByText('Gold after extension')).toBeTruthy();
  expect(screen.getByRole('button', { name: t('en', 'customerPackages.loadMore') })).toMatchObject({
    disabled: false,
  });
});
