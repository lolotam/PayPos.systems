'use client';
import {
  serviceLinePerformerChangesPage,
  serviceLinePerformerChangesQuery,
} from '@pospay/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import type { SessionServiceScope } from './use-session-services';

const changesPath =
  '/v1/businesses/{businessId}/branches/{branchId}/service-sessions/{sessionId}/lines/{lineId}/performer-changes';

// السجل بيتقرأ بس لما اللوحة تتفتح؛ السبب والأسماء والمغيّر ظاهرين هنا لأن القراءة محمية بصلاحية الفرع (FR-016).
export function useLinePerformerChanges(
  scope: SessionServiceScope,
  sessionId: string,
  lineId: string,
  enabled: boolean,
) {
  return useInfiniteQuery({
    queryKey: [
      'service-line-performer-changes',
      scope.companyId,
      scope.businessId,
      scope.branchId,
      scope.userId,
      sessionId,
      lineId,
    ],
    enabled,
    retry: false,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const query = serviceLinePerformerChangesQuery.parse({
        ...(pageParam ? { cursor: pageParam } : {}),
      });
      const result = await apiClient().GET(changesPath, {
        params: {
          header: { 'x-company-id': scope.companyId },
          path: { businessId: scope.businessId, branchId: scope.branchId, sessionId, lineId },
          query: { limit: query.limit, ...(query.cursor ? { cursor: query.cursor } : {}) },
        },
        signal,
      });
      if (result.error) throw { ...result.error, status: result.response.status };
      return serviceLinePerformerChangesPage.parse(result.data);
    },
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
}
