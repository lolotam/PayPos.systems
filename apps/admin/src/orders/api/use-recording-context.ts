'use client';
import { recordingContext, recordingContextQuery } from '@pospay/contracts';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import type { SessionServiceScope } from './use-session-services';

export function useRecordingContext(scope: SessionServiceScope, membershipId: string | null, enabled = true, anchor?: string) {
  return useQuery({
    queryKey: [anchor === undefined ? 'session-recording-context' : 'session-performer-context', scope.companyId, scope.businessId, scope.branchId, scope.userId, anchor ?? membershipId],
    ...(anchor === undefined ? {} : { staleTime: Infinity, gcTime: 0 }),
    enabled, retry: false,
    queryFn: async ({ signal }) => {
      const query = recordingContextQuery.parse({ recorder_membership_id: membershipId ?? undefined });
      const result = await apiClient().GET('/v1/businesses/{businessId}/branches/{branchId}/service-sessions/recording-context', {
        params: { header: { 'x-company-id': scope.companyId }, path: { businessId: scope.businessId, branchId: scope.branchId },
          query: query.recorder_membership_id ? { recorder_membership_id: query.recorder_membership_id } : {} }, signal,
      });
      if (result.error) throw { ...result.error, status: result.response.status };
      return recordingContext.parse(result.data);
    },
  });
}
