'use client';
import { customerPackagePage, customerPackagesQuery } from '@pospay/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import type { SessionServiceScope } from './use-session-services';

const packagesPath = '/v1/businesses/{businessId}/branches/{branchId}/customers/{customerId}/packages';

export function useCustomerPackages(scope: SessionServiceScope, customerId: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: ['customer-packages', scope.companyId, scope.businessId, scope.branchId, scope.userId, customerId],
    enabled,
    retry: false,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const query = customerPackagesQuery.parse({ cursor: pageParam });
      const result = await apiClient().GET(packagesPath, {
        params: {
          header: { 'x-company-id': scope.companyId },
          path: { businessId: scope.businessId, branchId: scope.branchId, customerId },
          query: { limit: query.limit, ...(query.cursor ? { cursor: query.cursor } : {}) },
        },
        signal,
      });
      if (result.error) throw { ...result.error, status: result.response.status };
      return customerPackagePage.parse(result.data);
    },
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    select: (data) => {
      const seen = new Set<string>();
      const items = data.pages.flatMap((page) => page.items).filter((item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      });
      return { ...data, items };
    },
  });
}
