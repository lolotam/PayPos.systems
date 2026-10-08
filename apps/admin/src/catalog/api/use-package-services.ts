'use client';
import { packageServiceOptionPage } from '@pospay/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';

export function usePackageServices(companyId: string, businessId: string, userId: string) {
  return useInfiniteQuery({
    queryKey: ['package-services', companyId, businessId, userId],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const response = await apiClient().GET(
        '/v1/businesses/{businessId}/package-types/service-options',
        {
          params: {
            header: { 'x-company-id': companyId },
            path: { businessId },
            query: { limit: 100, ...(pageParam ? { cursor: pageParam } : {}) },
          },
          signal,
        },
      );
      if (response.error) throw response.error;
      return packageServiceOptionPage.parse(response.data);
    },
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
}
