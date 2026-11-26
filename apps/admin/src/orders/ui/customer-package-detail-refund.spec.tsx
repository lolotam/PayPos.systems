import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { SessionServiceScope } from '../api/use-session-services';
import { CustomerPackageDetail } from './customer-package-detail';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const companyId = '01920000-0000-7000-8000-000000000101';
const businessId = '01920000-0000-7000-8000-000000000102';
const branchId = '01920000-0000-7000-8000-000000000103';
const customerId = '01920000-0000-7000-8000-0000000000f1';
const entitlementId = '01920000-0000-7000-8000-0000000000d1';
const componentId = '01920000-0000-7000-8000-0000000000e1';
const scope: SessionServiceScope = { companyId, businessId, branchId, userId: 'user' };
const queryKey = [
  'customer-package-detail',
  companyId,
  businessId,
  branchId,
  'user',
  customerId,
  entitlementId,
];

function detailBody(canRefund: boolean) {
  return {
    id: entitlementId,
    customer_id: customerId,
    package_type_id: '01920000-0000-7000-8000-0000000000d2',
    provenance: 'SOLD',
    name_en: 'Gold',
    name_ar: null,
    validity_days: 30,
    list_price: '40.000',
    price_paid: '36.000',
    discount: '4.000',
    discount_bps: 1000,
    paid_method: 'CASH',
    seller_employee_id: null,
    seller_linked_user_id: null,
    sold_branch_id: branchId,
    sold_at: '2026-11-01T10:00:00Z',
    sold_business_date: '2026-11-01',
    expires_on: '2026-12-01',
    business_timezone: 'Asia/Kuwait',
    refunded_amount: '0.000',
    revision: 1,
    can_extend: false,
    can_refund: canRefund,
    components: [
      {
        id: componentId,
        service_id: '01920000-0000-7000-8000-0000000001c1',
        position: 1,
        name_en: 'Haircut',
        name_ar: null,
        list_price_snapshot: '10.000',
        component_value: '9.000',
        sessions_total: 2,
        remaining: 2,
        used: 0,
        refunded: 0,
        slots: [
          { ordinal: 1, state: 'FREE', unit_value: '9.000' },
          { ordinal: 2, state: 'FREE', unit_value: '9.000' },
        ],
      },
    ],
    redemptions: [],
    extensions: [],
    refunds: [],
  };
}

function renderDetail(
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }),
) {
  return {
    client,
    view: render(
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
    ),
  };
}

function submitRefund() {
  fireEvent.click(screen.getByRole('button', { name: t('en', 'packageRefund.refund') }));
  fireEvent.change(screen.getByLabelText(t('en', 'packageRefund.component')), {
    target: { value: componentId },
  });
  fireEvent.change(screen.getByLabelText(t('en', 'packageRefund.reason')), {
    target: { value: 'Synthetic reason' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'packageRefund.submit') }));
}

beforeEach(() => {
  api.GET.mockReset();
  api.POST.mockReset();
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

it('shows Refund only when can_refund is true and closes the open dialog when can_refund becomes false', async () => {
  api.GET.mockResolvedValue({ data: detailBody(false), response: { status: 200 } });
  const hidden = renderDetail();
  await screen.findByText('Gold');
  expect(screen.queryByRole('button', { name: t('en', 'packageRefund.refund') })).toBeNull();
  hidden.view.unmount();

  api.GET.mockResolvedValue({ data: detailBody(true), response: { status: 200 } });
  const { client, view } = renderDetail();
  const refundButton = await screen.findByRole('button', { name: t('en', 'packageRefund.refund') });
  fireEvent.click(refundButton);
  expect(screen.getByRole('dialog', { name: t('en', 'packageRefund.dialogTitle') })).toBeTruthy();

  api.GET.mockResolvedValue({ data: detailBody(false), response: { status: 200 } });
  await act(async () => {
    await client.invalidateQueries({ queryKey });
  });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.queryByRole('button', { name: t('en', 'packageRefund.refund') })).toBeNull();
  view.unmount();
});

it('preserves the held Idempotency-Key across transient detail failure and retry', async () => {
  api.GET.mockResolvedValue({ data: detailBody(true), response: { status: 200 } });
  api.POST.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({
    data: {
      id: '01920000-0000-7000-8000-000000000099',
      entitlement_id: entitlementId,
      component_id: componentId,
      sessions: 1,
      amount: '9.000',
      method: 'CASH',
      refunded_amount: '9.000',
      revision: 2,
      refunded_at: '2026-11-26T05:00:00.000Z',
    },
    response: { status: 201 },
  });
  const { client } = renderDetail();
  await screen.findByText('Gold');
  submitRefund();
  expect(await screen.findByText(t('en', 'packageRefund.errorNetwork'))).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'packageRefund.cancel') }));

  api.GET.mockResolvedValueOnce({ error: { code: 'UNEXPECTED' }, response: { status: 500 } });
  await act(async () => {
    await client.invalidateQueries({ queryKey });
  });
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toContain(
      t('en', 'customerPackages.detailLoadFailed'),
    ),
  );

  api.GET.mockResolvedValue({ data: detailBody(true), response: { status: 200 } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'customerPackages.detailRetry') }));
  await screen.findByRole('button', { name: t('en', 'packageRefund.refund') });
  submitRefund();
  await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(2));
  expect(api.POST.mock.calls[1]?.[1].params.header['Idempotency-Key']).toBe(
    api.POST.mock.calls[0]?.[1].params.header['Idempotency-Key'],
  );
});
