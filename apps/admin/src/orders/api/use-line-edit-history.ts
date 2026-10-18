'use client';
import { serviceLineEditsPage, serviceLineEditsQuery } from '@pospay/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import type { SessionServiceScope } from './use-session-services';

const editsPath = '/v1/businesses/{businessId}/branches/{branchId}/service-sessions/{sessionId}/lines/{lineId}/edits';

// السجل بيتقرأ بس لما اللوحة تتفتح؛ السبب ظاهر هنا لأن القراءة محمية بصلاحية الفرع (LE-15).
export function useLineEditHistory(scope: SessionServiceScope, sessionId: string, lineId: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ['service-line-edits', scope.companyId, scope.businessId, scope.branchId, scope.userId, sessionId, lineId],
    enabled, retry: false, initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const query = serviceLineEditsQuery.parse({ ...(pageParam ? { cursor: pageParam } : {}) });
      const result = await apiClient().GET(editsPath, {
        params: { header: { 'x-company-id': scope.companyId },
          path: { businessId: scope.businessId, branchId: scope.branchId, sessionId, lineId },
          query: { limit: query.limit, ...(query.cursor ? { cursor: query.cursor } : {}) } }, signal,
      });
      if (result.error) throw { ...result.error, status: result.response.status };
      return serviceLineEditsPage.parse(result.data);
    },
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
}
