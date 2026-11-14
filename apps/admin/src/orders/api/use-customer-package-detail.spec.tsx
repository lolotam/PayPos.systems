import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useCustomerPackageDetail } from './use-customer-package-detail';

const state = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: state.get }) }));

const scope = {
  companyId: '01920000-0000-7000-8000-000000000001',
  businessId: '01920000-0000-7000-8000-000000000002',
  branchId: '01920000-0000-7000-8000-000000000003',
  userId: '01920000-0000-7000-8000-000000000004',
};
const customerId = '01920000-0000-7000-8000-000000000005';
const entitlementId = '01920000-0000-7000-8000-000000000006';

const sampleDetail = {
  id: entitlementId,
  customer_id: customerId,
  package_type_id: '01920000-0000-7000-8000-000000000007',
  provenance: 'SOLD' as const,
  name_en: 'Package 1',
  name_ar: null,
  validity_days: 90,
  list_price: '30.000',
  price_paid: '30.000',
  discount: '0.000',
  discount_bps: 0,
  paid_method: 'CASH' as const,
  seller_employee_id: '01920000-0000-7000-8000-000000000008',
  seller_linked_user_id: '01920000-0000-7000-8000-000000000009',
  sold_branch_id: '01920000-0000-7000-8000-000000000010',
  sold_at: '2026-10-15T10:00:00.000Z',
  sold_business_date: '2026-10-15',
  expires_on: '2027-01-13',
  refunded_amount: '0.000',
  revision: 1,
  can_extend: false,
  components: [
    {
      id: '01920000-0000-7000-8000-000000000020',
      service_id: '01920000-0000-7000-8000-000000000030',
      position: 1,
      name_en: 'Service 1',
      name_ar: null,
      list_price_snapshot: '10.000',
      component_value: '30.000',
      sessions_total: 3,
      remaining: 3,
      used: 0,
      refunded: 0,
      slots: [
        { ordinal: 1, state: 'FREE' as const, unit_value: '10.000' },
        { ordinal: 2, state: 'FREE' as const, unit_value: '10.000' },
        { ordinal: 3, state: 'FREE' as const, unit_value: '10.000' },
      ],
    },
  ],
  redemptions: [],
  extensions: [],
};

function setup(targetId: string | null) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return {
    client,
    ...renderHook(() => useCustomerPackageDetail(scope, customerId, targetId), { wrapper }),
  };
}

it('is disabled and performs no fetch when entitlementId is null', () => {
  state.get.mockReset();
  const hook = setup(null);

  expect(hook.result.current.fetchStatus).toBe('idle');
  expect(state.get).not.toHaveBeenCalled();
});

it('fetches the detail path when entitlementId is set and returns parsed detail', async () => {
  state.get.mockReset();
  state.get.mockResolvedValueOnce({
    data: sampleDetail,
    response: { status: 200 },
  });

  const hook = setup(entitlementId);
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));

  expect(state.get).toHaveBeenCalledWith(
    '/v1/businesses/{businessId}/branches/{branchId}/customers/{customerId}/packages/{entitlementId}',
    {
      params: {
        header: { 'x-company-id': scope.companyId },
        path: {
          businessId: scope.businessId,
          branchId: scope.branchId,
          customerId,
          entitlementId,
        },
      },
      signal: expect.any(AbortSignal),
    },
  );

  expect(hook.result.current.data).toEqual(sampleDetail);
});

it('surfaces a 404 envelope as the query error with status 404', async () => {
  state.get.mockReset();
  const notFoundEnvelope = {
    code: 'PACKAGE_NOT_FOUND',
    message_ar: 'Package not found AR',
    message_en: 'Package not found.',
  };
  state.get.mockResolvedValueOnce({
    error: notFoundEnvelope,
    response: { status: 404 },
  });

  const hook = setup(entitlementId);
  await waitFor(() => expect(hook.result.current.isError).toBe(true));

  expect(hook.result.current.error).toEqual({
    ...notFoundEnvelope,
    status: 404,
  });
});

it('exposes redemptions in the order returned by the server', async () => {
  state.get.mockReset();
  const redemptions = [
    {
      id: '01920000-0000-7000-8000-000000000041',
      component_id: '01920000-0000-7000-8000-000000000020',
      ordinal: 3,
      redeemed_at: '2026-10-20T10:00:00.000Z',
      visit_business_date: '2026-10-19',
      reversed_at: null,
    },
    {
      id: '01920000-0000-7000-8000-000000000040',
      component_id: '01920000-0000-7000-8000-000000000020',
      ordinal: 2,
      redeemed_at: '2026-10-20T09:00:00.000Z',
      visit_business_date: '2026-10-18',
      reversed_at: '2026-10-21T09:00:00.000Z',
    },
  ];
  state.get.mockResolvedValueOnce({ data: { ...sampleDetail, redemptions }, response: { status: 200 } });
  const hook = setup(entitlementId);
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  expect(hook.result.current.data?.redemptions).toEqual(redemptions);
  expect(hook.result.current.data?.redemptions.map((row) => row.id)).toEqual([redemptions[0]?.id, redemptions[1]?.id]);
});
