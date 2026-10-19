'use client';
import { serviceLineCancellation } from '@pospay/contracts';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import type { SessionServiceScope } from './use-session-services';

const cancellationPath =
  '/v1/businesses/{businessId}/branches/{branchId}/service-sessions/{sessionId}/lines/{lineId}/cancellation';

export function useServiceLineCancellation(
  scope: SessionServiceScope,
  sessionId: string,
  lineId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: [
      'service-line-cancellations',
      scope.companyId,
      scope.businessId,
      scope.branchId,
      scope.userId,
      sessionId,
      lineId,
    ],
    enabled,
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await apiClient().GET(cancellationPath, {
        params: {
          header: { 'x-company-id': scope.companyId },
          path: { businessId: scope.businessId, branchId: scope.branchId, sessionId, lineId },
        },
        signal,
      });
      if (result.error) throw { ...result.error, status: result.response.status };
      return serviceLineCancellation.parse(result.data);
    },
  });
}
