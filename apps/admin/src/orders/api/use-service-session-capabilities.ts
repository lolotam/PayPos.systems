'use client';
import { serviceSessionCapabilities } from '@pospay/contracts';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import type { SessionServiceScope } from './use-session-services';

const capabilitiesPath =
  '/v1/businesses/{businessId}/branches/{branchId}/service-sessions/capabilities';

export function useServiceSessionCapabilities(scope: SessionServiceScope, enabled: boolean) {
  return useQuery({
    queryKey: [
      'service-session-capabilities',
      scope.companyId,
      scope.businessId,
      scope.branchId,
      scope.userId,
    ],
    enabled,
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await apiClient().GET(capabilitiesPath, {
        params: {
          header: { 'x-company-id': scope.companyId },
          path: { businessId: scope.businessId, branchId: scope.branchId },
        },
        signal,
      });
      if (result.error) throw { ...result.error, status: result.response.status };
      return serviceSessionCapabilities.parse(result.data);
    },
  });
}
