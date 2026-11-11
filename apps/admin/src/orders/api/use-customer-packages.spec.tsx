import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useCustomerPackages } from './use-customer-packages';

const state = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: state.get }) }));

const scope = {
  companyId: '01920000-0000-7000-8000-000000000001',
  businessId: '01920000-0000-7000-8000-000000000002',
  branchId: '01920000-0000-7000-8000-000000000003',
  userId: '01920000-0000-7000-8000-000000000004',
};
const customerId = '01920000-0000-7000-8000-000000000005';

const item1 = {
  id: '01920000-0000-7000-8000-000000000010',
  provenance: 'SOLD' as const,
  name_en: 'Package 1',
  name_ar: null,
  expires_on: '2027-01-01',
  expired: false,
  used_up: false,
  price_paid: '20.000',
  refunded_amount: '0.000',
  components: [
    {
      id: '01920000-0000-7000-8000-000000000020',
      service_id: '01920000-0000-7000-8000-000000000030',
      position: 1,
      name_en: 'Service 1',
      name_ar: null,
      sessions_total: 2,
      remaining: 2,
      used: 0,
      refunded: 0,
      next_unit_value: '10.000',
      slot_values: [{ unit_value: '10.000', free: 2, used: 0, refunded: 0 }],
    },
  ],
};

const item2 = {
  ...item1,
  id: '01920000-0000-7000-8000-000000000011',
  name_en: 'Package 2',
};

const item3 = {
  ...item1,
  id: '01920000-0000-7000-8000-000000000012',
  name_en: 'Package 3',
};

function setup(enabled = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return {
    client,
    ...renderHook(() => useCustomerPackages(scope, customerId, enabled), { wrapper }),
  };
}

it('calls the list path with x-company-id header and limit 20, and fetchNextPage sends the cursor', async () => {
  state.get.mockReset();
  state.get
    .mockResolvedValueOnce({
      data: { items: [item1], next_cursor: 'opaque_cursor_page_1' },
      response: { status: 200 },
    })
    .mockResolvedValueOnce({
      data: { items: [item2], next_cursor: null },
      response: { status: 200 },
    });

  const hook = setup();
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));

  // تحقق من النتيجة الظاهرة للمستخدم
  expect(hook.result.current.data?.items).toEqual([item1]);

  expect(state.get).toHaveBeenCalledWith(
    '/v1/businesses/{businessId}/branches/{branchId}/customers/{customerId}/packages',
    {
      params: {
        header: { 'x-company-id': scope.companyId },
        path: {
          businessId: scope.businessId,
          branchId: scope.branchId,
          customerId,
        },
        query: { limit: 20 },
      },
      signal: expect.any(AbortSignal),
    },
  );

  // جلب الصفحة التالية يرسل المؤشر
  await act(async () => {
    await hook.result.current.fetchNextPage();
  });

  await waitFor(() => expect(hook.result.current.data?.items).toHaveLength(2));
  expect(hook.result.current.data?.items).toEqual([item1, item2]);

  expect(state.get).toHaveBeenLastCalledWith(
    '/v1/businesses/{businessId}/branches/{branchId}/customers/{customerId}/packages',
    {
      params: {
        header: { 'x-company-id': scope.companyId },
        path: {
          businessId: scope.businessId,
          branchId: scope.branchId,
          customerId,
        },
        query: { limit: 20, cursor: 'opaque_cursor_page_1' },
      },
      signal: expect.any(AbortSignal),
    },
  );
});

it('select de-duplicates an id repeated across pages and reflects on visible items', async () => {
  state.get.mockReset();
  state.get
    .mockResolvedValueOnce({
      data: { items: [item1, item2], next_cursor: 'opaque_cursor_1' },
      response: { status: 200 },
    })
    .mockResolvedValueOnce({
      data: { items: [item2, item3], next_cursor: null },
      response: { status: 200 },
    });

  const hook = setup();
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  expect(hook.result.current.data?.items.map((item) => item.id)).toEqual([
    item1.id,
    item2.id,
  ]);

  await act(async () => {
    await hook.result.current.fetchNextPage();
  });

  await waitFor(() => expect(hook.result.current.data?.pages).toHaveLength(2));
  // تم إزالة تكرار item2
  expect(hook.result.current.data?.items.map((item) => item.id)).toEqual([
    item1.id,
    item2.id,
    item3.id,
  ]);
});

it('surfaces an error envelope as the query error with its status and reflects isError', async () => {
  state.get.mockReset();
  const errorEnvelope = {
    code: 'FORBIDDEN',
    message_ar: 'Forbidden AR',
    message_en: 'This action is not allowed',
  };
  state.get.mockResolvedValueOnce({
    error: errorEnvelope,
    response: { status: 403 },
  });

  const hook = setup();
  await waitFor(() => expect(hook.result.current.isError).toBe(true));

  expect(hook.result.current.error).toEqual({
    ...errorEnvelope,
    status: 403,
  });
  expect(hook.result.current.isError).toBe(true);
});
