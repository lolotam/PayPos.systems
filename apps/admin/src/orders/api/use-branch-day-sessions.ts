'use client';
import { serviceSessionDayPage, serviceSessionDayQuery } from '@pospay/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import type { SessionServiceScope } from './use-session-services';

const dayPath = '/v1/businesses/{businessId}/branches/{branchId}/service-sessions';

export function useBranchDaySessions(scope: SessionServiceScope, date: string, late: boolean, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ['branch-day-sessions', scope.companyId, scope.businessId, scope.branchId, scope.userId, date, late],
    enabled: enabled && /^\d{4}-\d{2}-\d{2}$/.test(date), retry: false, initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const query = serviceSessionDayQuery.parse({ date, ...(late ? { late: 'true' as const } : {}), ...(pageParam ? { cursor: pageParam } : {}) });
      const result = await apiClient().GET(dayPath, {
        params: { header: { 'x-company-id': scope.companyId }, path: { businessId: scope.businessId, branchId: scope.branchId },
          query: { date: query.date, limit: query.limit, ...(query.late ? { late: query.late } : {}), ...(query.cursor ? { cursor: query.cursor } : {}) } },
        signal,
      });
      if (result.error) throw { ...result.error, status: result.response.status };
      return serviceSessionDayPage.parse(result.data);
    },
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
}
