import type { ReactNode } from 'react';
import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { usePackageServices } from './use-package-services';

const get = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: get }) }));
const companyId = '01920000-0000-7000-8000-000000000001';
const businessId = '01920000-0000-7000-8000-000000000002';
const userId = '01920000-0000-7000-8000-000000000003';
const option = {
  id: '01920000-0000-7000-8000-000000000004',
  name_ar: null,
  name_en: 'Synthetic option',
  price: '0.000',
  active: true,
};

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}
beforeEach(() => get.mockReset());

it('loads package-scoped options and subsequent pages through the generated client', async () => {
  get.mockResolvedValueOnce({ data: { items: [option], next_cursor: option.id } });
  get.mockResolvedValueOnce({ data: { items: [], next_cursor: null } });
  const hook = renderHook(() => usePackageServices(companyId, businessId, userId), {
    wrapper: wrapper(),
  });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  expect(hook.result.current.data?.pages[0]?.items).toEqual([option]);
  await act(async () => {
    await hook.result.current.fetchNextPage();
  });
  for (const [index, query] of [{ limit: 100 }, { limit: 100, cursor: option.id }].entries()) {
    expect(get).toHaveBeenNthCalledWith(
      index + 1,
      '/v1/businesses/{businessId}/package-types/service-options',
      {
        params: { header: { 'x-company-id': companyId }, path: { businessId }, query },
        signal: expect.any(AbortSignal),
      },
    );
  }
  await waitFor(() => expect(hook.result.current.hasNextPage).toBe(false));
});

it('keeps the bilingual refusal from the package endpoint', async () => {
  const error = {
    code: 'FORBIDDEN',
    message_ar: t('ar', 'errors.FORBIDDEN'),
    message_en: 'Forbidden',
  };
  get.mockResolvedValueOnce({ error });
  const hook = renderHook(() => usePackageServices(companyId, businessId, userId), {
    wrapper: wrapper(),
  });
  await waitFor(() => expect(hook.result.current.isError).toBe(true));
  expect(hook.result.current.error).toEqual(error);
  expect(get).toHaveBeenCalledTimes(1);
});
