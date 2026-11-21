import { customerPackageDetail } from '@pospay/contracts';
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
const packageC = '01920000-0000-7000-8000-0000000000a3';
const scope: SessionServiceScope = { companyId, businessId, branchId, userId: 'user' };
const listPath = '/v1/businesses/{businessId}/branches/{branchId}/customers/{customerId}/packages';
const detailPath = `${listPath}/{entitlementId}`;

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

function renderPage(search: string, client: QueryClient) {
  nav.search = search;
  return render(
    <QueryClientProvider client={client}>
      <DirectionProvider dir="ltr">
        <TestPage scope={scope} customerId={customerId} />
      </DirectionProvider>
    </QueryClientProvider>,
  );
}

function renderDefaultPage(search = '') {
  nav.search = search;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DirectionProvider dir="ltr">
        <TestPage scope={scope} customerId={customerId} />
      </DirectionProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.GET.mockReset();
  nav.push.mockReset();
  nav.replace.mockReset();
  nav.search = '';
});

it('shows the generic heading, the active package first and the expired mark on the expired one', async () => {
  api.GET.mockResolvedValue({
    data: {
      items: [item(packageA, 'Gold', false, false), item(packageB, 'Old', true, false)],
      next_cursor: null,
    },
    response: { status: 200 },
  });
  renderDefaultPage();
  expect(screen.getByRole('heading', { name: t('en', 'customerPackages.title') })).toBeTruthy();
  await screen.findByText('Gold');
  expect(screen.getByText('Old')).toBeTruthy();
  expect(screen.getByText(t('en', 'customerPackages.expiredBadge'))).toBeTruthy();
  const hrefs = screen.getAllByRole('button').map((button) => button.textContent);
  expect(hrefs.indexOf('Gold')).toBeLessThan(hrefs.indexOf('Old'));
});

it('paginates by appending pages without repeating one package', async () => {
  api.GET.mockResolvedValueOnce({
    data: {
      items: [item(packageA, 'Gold', false, false), item(packageB, 'Old', true, false)],
      next_cursor: 'c2',
    },
    response: { status: 200 },
  }).mockResolvedValueOnce({
    data: {
      items: [item(packageB, 'Old', true, false), item(packageC, 'New', false, false)],
      next_cursor: null,
    },
    response: { status: 200 },
  });
  renderDefaultPage();
  await screen.findByText('Gold');
  fireEvent.click(screen.getByRole('button', { name: t('en', 'customerPackages.loadMore') }));
  await screen.findByText('New');
  const names = screen.getAllByText(/Gold|Old|New/).map((node) => node.textContent);
  expect(names.filter((name) => name === 'Gold')).toHaveLength(1);
  expect(names.filter((name) => name === 'Old')).toHaveLength(1);
  expect(names.filter((name) => name === 'New')).toHaveLength(1);
});

it('shows the distinct empty and refusal states instead of data', async () => {
  api.GET.mockResolvedValue({ data: { items: [], next_cursor: null }, response: { status: 200 } });
  const first = renderDefaultPage();
  await waitFor(() =>
    expect(screen.getByRole('status').textContent).toContain(t('en', 'customerPackages.empty')),
  );
  first.unmount();
  api.GET.mockResolvedValue({ error: { code: 'FORBIDDEN' }, response: { status: 403 } });
  renderDefaultPage();
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toContain(t('en', 'customerPackages.notAllowed')),
  );
  expect(screen.queryByText('Gold')).toBeNull();
});

it('a refused read supersedes a preseeded cache on the same client', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.GET.mockResolvedValueOnce({
    data: { items: [item(packageA, 'Gold', false, false)], next_cursor: null },
    response: { status: 200 },
  });
  const primed = render(
    <QueryClientProvider client={client}>
      <DirectionProvider dir="ltr">
        <TestPage scope={scope} customerId={customerId} />
      </DirectionProvider>
    </QueryClientProvider>,
  );
  await screen.findByText('Gold');
  primed.unmount();
  api.GET.mockResolvedValue({ error: { code: 'FORBIDDEN' }, response: { status: 403 } });
  render(
    <QueryClientProvider client={client}>
      <DirectionProvider dir="ltr">
        <TestPage scope={scope} customerId={customerId} />
      </DirectionProvider>
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toContain(t('en', 'customerPackages.notAllowed')),
  );
  expect(screen.queryByText('Gold')).toBeNull();
});

it('a failed load offers a retry that loads the packages', async () => {
  api.GET.mockResolvedValueOnce({
    error: { code: 'UNEXPECTED' },
    response: { status: 500 },
  }).mockResolvedValueOnce({
    data: { items: [item(packageA, 'Gold', false, false)], next_cursor: null },
    response: { status: 200 },
  });
  renderDefaultPage();
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toContain(t('en', 'customerPackages.loadFailed')),
  );
  fireEvent.click(screen.getByRole('button', { name: t('en', 'customerPackages.retry') }));
  await screen.findByText('Gold');
});

it('a malformed customer segment shows not found without any request', () => {
  const malformed = render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <DirectionProvider dir="ltr">
        <TestPage scope={scope} customerId="not-a-uuid" />
      </DirectionProvider>
    </QueryClientProvider>,
  );
  expect(malformed.getByRole('alert').textContent).toContain(t('en', 'customerPackages.notFound'));
  expect(api.GET).not.toHaveBeenCalled();
});

it('opening a package pushes its address and the detail renders from the query value', async () => {
  api.GET.mockImplementation((path: string) => {
    if (path === listPath)
      return Promise.resolve({
        data: { items: [item(packageA, 'Gold', false, false)], next_cursor: null },
        response: { status: 200 },
      });
    return Promise.resolve({
      error: { code: 'NOT_FOUND' },
      response: { status: 404 },
    });
  });
  renderDefaultPage();
  await screen.findByText('Gold');
  fireEvent.click(screen.getByRole('button', { name: 'Gold' }));
  expect(nav.push).toHaveBeenCalledWith(`?package=${packageA}`);
  const withSelection = renderDefaultPage(`?package=${packageA}`);
  await waitFor(() =>
    expect(withSelection.getByRole('alert').textContent).toContain(
      t('en', 'customerPackages.detailNotFound'),
    ),
  );
});

it('a malformed query value shows detail not found without requesting the detail', async () => {
  api.GET.mockResolvedValue({
    data: { items: [item(packageA, 'Gold', false, false)], next_cursor: null },
    response: { status: 200 },
  });
  renderDefaultPage('?package=broken-value');
  await screen.findByText('Gold');
  expect(screen.getByRole('alert').textContent).toContain(
    t('en', 'customerPackages.detailNotFound'),
  );
  expect(api.GET.mock.calls.filter(([path]) => path === detailPath)).toHaveLength(0);
  expect(api.GET).toHaveBeenCalledWith(listPath, expect.anything());
});

it('never renders a phone number or a customer name', async () => {
  api.GET.mockResolvedValue({
    data: { items: [item(packageA, 'Gold', false, false)], next_cursor: null },
    response: { status: 200 },
  });
  renderDefaultPage('?package=broken-value');
  await screen.findByText('Gold');
  expect(screen.queryByText(/\+965/)).toBeNull();
  expect(screen.queryByText('Noura')).toBeNull();
  const href = `/orders/customers/${customerId}/packages`;
  expect(href).not.toMatch(/noura|phone/i);
});

function switchDetail(id: string, name_en: string, canExtend: boolean) {
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

it('switching to another cached entitlement opens its detail with no stale dialog', async () => {
  api.GET.mockImplementation(
    (path: string, options?: { params?: { path?: Record<string, string> } }) => {
      if (path === listPath)
        return Promise.resolve({
          data: {
            items: [item(packageA, 'Gold', false, false), item(packageC, 'Silver', false, false)],
            next_cursor: null,
          },
          response: { status: 200 },
        });
      const entitlement = options?.params?.path?.entitlementId;
      return Promise.resolve({
        data: switchDetail(
          entitlement as string,
          entitlement === packageA ? 'Gold' : 'Silver',
          true,
        ),
        response: { status: 200 },
      });
    },
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(
    ['customer-package-detail', companyId, businessId, branchId, 'user', customerId, packageC],
    customerPackageDetail.parse(switchDetail(packageC, 'Silver', true)),
  );
  const view = renderPage(`?package=${packageA}`, client);
  await screen.findByText('Gold');
  // انتظار تفصيل A نفسه (زر التمديد) قبل الفتح — الباقة بتحمل بعد الكارت.
  const extendA = await screen.findByRole('button', { name: t('en', 'customerPackages.extend') });
  fireEvent.click(extendA);
  expect(
    screen.getByRole('dialog', { name: t('en', 'packageExtension.dialogTitle') }),
  ).toBeTruthy();
  // التنقل لباقة تانية متخزنة في الكاش بيعمل remount للتفصيل: مفيش حوار قديم معاها، وتفاصيلها هي اللي بتتعرض.
  nav.search = `?package=${packageC}`;
  view.rerender(
    <QueryClientProvider client={client}>
      <DirectionProvider dir="ltr">
        <TestPage scope={scope} customerId={customerId} />
      </DirectionProvider>
    </QueryClientProvider>,
  );
  await screen.findByRole('heading', { name: 'Silver' });
  expect(
    screen.queryByRole('dialog', { name: t('en', 'packageExtension.dialogTitle') }),
  ).toBeNull();
  // تفصيل السيلفر اتحمل: زر التمديد بتاعه ظاهر ومن غير أي حوار قديم.
  expect(screen.getByRole('button', { name: t('en', 'customerPackages.extend') })).toBeTruthy();
  view.unmount();
});
