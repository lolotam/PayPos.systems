'use client';
import { sellablePackageTypeListQuery, sellablePackageTypePage } from '@pospay/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import { packageSaleParams, packageSaleScopeKey } from './use-package-sale-context';
import type { SessionServiceScope } from './use-session-services';

const typesPath = '/v1/businesses/{businessId}/branches/{branchId}/sellable-package-types';

export function useSellablePackageTypes(scope: SessionServiceScope, enabled = true) {
  return useInfiniteQuery({
    queryKey: ['sellable-package-types', ...packageSaleScopeKey(scope)],
    enabled,
    retry: false,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const query = sellablePackageTypeListQuery.parse({ cursor: pageParam });
      const result = await apiClient().GET(typesPath, {
        params: {
          ...packageSaleParams(scope),
          query: { limit: query.limit, ...(query.cursor ? { cursor: query.cursor } : {}) },
        },
        signal,
      });
      if (result.error) throw { ...result.error, status: result.response.status };
      return sellablePackageTypePage.parse(result.data);
    },
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    select: (data) => ({ ...data, items: data.pages.flatMap((page) => page.items) }),
  });
}
