import type { ReactNode } from 'react';
import type { ServiceCategoryListItem } from '@pospay/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useOpenServiceCategories } from './use-service-categories';

const get = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: get }) }));

const companyId = '01920000-0000-7000-8000-000000000001';
const businessId = '01920000-0000-7000-8000-000000000002';
const userId = '01920000-0000-7000-8000-000000000003';
const firstCategory: ServiceCategoryListItem = {
  id: '01920000-0000-7000-8000-0000000000c1',
  name_en: 'Hair',
  name_ar: 'شعر',
  visibility: 'BUSINESS',
  owner_branch_id: null,
  closed_at: null,
  revision: 1,
};
const secondCategory: ServiceCategoryListItem = {
  ...firstCategory,
  id: '01920000-0000-7000-8000-0000000000c2',
  name_en: 'Nails',
  name_ar: 'أظافر',
};
const nextCursor = JSON.stringify([firstCategory.name_en, firstCategory.id]);

function wrapper() {
  const client = new QueryClient();
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => get.mockReset());

it('joins open category pages through next_cursor', async () => {
  get.mockResolvedValueOnce({
    data: { items: [firstCategory], next_cursor: nextCursor },
    response: { status: 200 },
  });
  get.mockResolvedValueOnce({
    data: { items: [secondCategory], next_cursor: null },
    response: { status: 200 },
  });
  const hook = renderHook(() => useOpenServiceCategories(companyId, businessId, userId), {
    wrapper: wrapper(),
  });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  expect(hook.result.current.data).toEqual([firstCategory, secondCategory]);
  for (const [index, query] of [
    { status: 'open', limit: 100 },
    { status: 'open', limit: 100, cursor: nextCursor },
  ].entries()) {
    expect(get).toHaveBeenNthCalledWith(
      index + 1,
      '/v1/businesses/{businessId}/service-categories',
      {
        params: { header: { 'x-company-id': companyId }, path: { businessId }, query },
        signal: expect.any(AbortSignal),
      },
    );
  }
});

it('keeps a 403 refusal visible to the caller without retrying it', async () => {
  const error = {
    code: 'FORBIDDEN',
    message_ar: 'مرفوض',
    message_en: 'Forbidden',
  };
  get.mockResolvedValueOnce({ error, response: { status: 403 } });
  const hook = renderHook(() => useOpenServiceCategories(companyId, businessId, userId), {
    wrapper: wrapper(),
  });
  await waitFor(() => expect(hook.result.current.isError).toBe(true));
  expect(hook.result.current.error).toEqual({ ...error, status: 403 });
  expect(get).toHaveBeenCalledTimes(1);
});
