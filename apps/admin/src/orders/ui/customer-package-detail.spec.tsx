import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { SessionServiceScope } from '../api/use-session-services';
import { CustomerPackageDetail } from './customer-package-detail';

const api = vi.hoisted(() => ({ GET: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const companyId = '01920000-0000-7000-8000-000000000101';
const businessId = '01920000-0000-7000-8000-000000000102';
const branchId = '01920000-0000-7000-8000-000000000103';
const customerId = '01920000-0000-7000-8000-0000000000f1';
const entitlementId = '01920000-0000-7000-8000-0000000000d1';
const scope: SessionServiceScope = { companyId, businessId, branchId, userId: 'user' };
const detailPath =
  '/v1/businesses/{businessId}/branches/{branchId}/customers/{customerId}/packages/{entitlementId}';

function soldComponents() {
  return [
    {
      id: '01920000-0000-7000-8000-0000000000e1',
      service_id: '01920000-0000-7000-8000-0000000001c1',
      position: 1,
      name_en: 'Haircut',
      name_ar: null,
      list_price_snapshot: '10.000',
      component_value: '9.000',
      sessions_total: 4,
      remaining: 2,
      used: 1,
      refunded: 1,
      slots: [
        { ordinal: 1, state: 'USED', unit_value: '9.000' },
        { ordinal: 2, state: 'REFUNDED', unit_value: '9.000' },
        { ordinal: 3, state: 'FREE', unit_value: '9.000' },
        { ordinal: 4, state: 'IMPORTED_USED', unit_value: '9.000' },
      ],
    },
  ];
}

function soldDetail(canExtend: boolean) {
  return {
    id: entitlementId,
    customer_id: customerId,
    package_type_id: '01920000-0000-7000-8000-0000000000d2',
    provenance: 'SOLD',
    name_en: 'Gold',
    name_ar: 'Ø°Ù‡Ø¨ÙŠØ©',
    validity_days: 30,
    list_price: '40.000',
    price_paid: '36.000',
    discount: '4.000',
    discount_bps: 1000,
    paid_method: 'CASH',
    seller_employee_id: '01920000-0000-7000-8000-0000000000d3',
    seller_linked_user_id: null,
    sold_branch_id: '01920000-0000-7000-8000-000000000103',
    sold_at: '2026-11-01T10:00:00Z',
    sold_business_date: '2026-11-01',
    expires_on: '2026-12-01',
    business_timezone: 'Asia/Kuwait',
    refunded_amount: '5.000',
    revision: 1,
    can_extend: canExtend,
    components: soldComponents(),
    redemptions: soldRedemptions(),
    extensions: soldExtensions(),
  };
}

function soldRedemptions() {
  return [
    {
      id: '01920000-0000-7000-8000-0000000000e2',
      component_id: '01920000-0000-7000-8000-0000000000e1',
      ordinal: 1,
      redeemed_at: '2026-11-02T12:00:00Z',
      visit_business_date: '2026-11-02',
      reversed_at: null,
    },
  ];
}

function soldExtensions() {
  return [
    {
      id: '01920000-0000-7000-8000-0000000000e3',
      previous_expires_on: '2026-12-01',
      new_expires_on: '2027-01-01',
      extended_at: '2026-11-20T09:00:00Z',
      reason: 'Client abroad',
    },
  ];
}

function renderDetail() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DirectionProvider dir="ltr">
        <CustomerPackageDetail
          scope={scope}
          customerId={customerId}
          entitlementId={entitlementId}
          onClose={() => undefined}
        />
      </DirectionProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.GET.mockReset();
});

it('a sold package shows its sale facts, the sessions one by one, the visits and the extensions', async () => {
  api.GET.mockResolvedValue({ data: soldDetail(true), response: { status: 200 } });
  renderDetail();
  await screen.findByText('Gold');
  expect(screen.getByText(t('en', 'customerPackages.sold'))).toBeTruthy();
  expect(screen.getByText(t('en', 'customerPackages.listPrice')).textContent).toContain('40.000');
  expect(screen.getByText(t('en', 'customerPackages.discount')).textContent).toContain('4.000');
  expect(screen.getByText(t('en', 'customerPackages.pricePaid')).textContent).toContain('36.000');
  expect(screen.getByText(t('en', 'packageSale.cash'))).toBeTruthy();
  expect(screen.getByText(t('en', 'customerPackages.saleDate')).textContent).toContain(
    '2026-11-01',
  );
  expect(screen.getByText(t('en', 'customerPackages.validityDays')).textContent).toContain('30');
  expect(screen.getByText('Haircut')).toBeTruthy();
  expect(screen.getByText(t('en', 'customerPackages.slotImportedUsed'))).toBeTruthy();
  expect(
    screen.getByText(t('en', 'customerPackages.refundedCount').replace('{n}', '1')),
  ).toBeTruthy();
  expect(
    screen.getByText(t('en', 'serviceSessions.packageHistorySession').replace('{n}', '1')),
  ).toBeTruthy();
  expect(screen.getByText('2026-11-02')).toBeTruthy();
  expect(screen.getByText('Client abroad')).toBeTruthy();
  expect(api.GET).toHaveBeenCalledWith(
    detailPath,
    expect.objectContaining({
      params: expect.objectContaining({
        path: { businessId, branchId, customerId, entitlementId },
      }),
    }),
  );
});

it('the raw identifiers of seller, branch and package type never render', async () => {
  api.GET.mockResolvedValue({ data: soldDetail(false), response: { status: 200 } });
  renderDetail();
  await screen.findByText('Gold');
  const body = document.body.textContent ?? '';
  expect(body).not.toContain('01920000-0000-7000-8000-0000000000d2');
  expect(body).not.toContain('01920000-0000-7000-8000-0000000000d3');
});

it('an imported package marks itself and never renders absent sale facts as empty labels', async () => {
  const imported = {
    ...soldDetail(false),
    provenance: 'IMPORTED',
    package_type_id: null,
    validity_days: null,
    list_price: null,
    discount: null,
    discount_bps: null,
    paid_method: null,
    seller_employee_id: null,
    sold_branch_id: null,
    sold_at: null,
    sold_business_date: null,
  };
  api.GET.mockResolvedValue({ data: imported, response: { status: 200 } });
  renderDetail();
  await screen.findByText('Gold');
  expect(screen.getByText(t('en', 'customerPackages.imported'))).toBeTruthy();
  expect(screen.queryByText(t('en', 'customerPackages.listPrice'))).toBeNull();
  expect(screen.queryByText(t('en', 'customerPackages.discount'))).toBeNull();
  expect(screen.queryByText(t('en', 'customerPackages.saleDate'))).toBeNull();
  expect(screen.queryByText(t('en', 'customerPackages.validityDays'))).toBeNull();
  expect(screen.queryByText(t('en', 'packageSale.cash'))).toBeNull();
});

it('the Extend button follows can_extend only', async () => {
  api.GET.mockResolvedValue({ data: soldDetail(false), response: { status: 200 } });
  const withoutButton = renderDetail();
  await screen.findByText('Gold');
  expect(screen.queryByRole('button', { name: t('en', 'customerPackages.extend') })).toBeNull();
  withoutButton.unmount();
  api.GET.mockResolvedValue({ data: soldDetail(true), response: { status: 200 } });
  renderDetail();
  const extend = await screen.findByRole('button', { name: t('en', 'customerPackages.extend') });
  expect(extend).toBeTruthy();
});

it('a refused or unknown package and a network failure each show their own state', async () => {
  api.GET.mockResolvedValue({ error: { code: 'FORBIDDEN' }, response: { status: 403 } });
  const refused = renderDetail();
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toContain(
      t('en', 'customerPackages.detailNotAllowed'),
    ),
  );
  refused.unmount();
  api.GET.mockResolvedValue({ error: { code: 'NOT_FOUND' }, response: { status: 404 } });
  const unknown = renderDetail();
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toContain(
      t('en', 'customerPackages.detailNotFound'),
    ),
  );
  unknown.unmount();
  api.GET.mockResolvedValue({ error: { code: 'UNEXPECTED' }, response: { status: 500 } });
  renderDetail();
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toContain(
      t('en', 'customerPackages.detailLoadFailed'),
    ),
  );
  api.GET.mockResolvedValue({ data: soldDetail(true), response: { status: 200 } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'customerPackages.detailRetry') }));
  await screen.findByText('Gold');
});
