'use client';
import { employeeNumberCapability } from '@pospay/contracts';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';

export function useEmployeeNumberCapability(
  companyId: string,
  businessId: string,
  userId: string,
  branchId: string,
) {
  return useQuery({
    queryKey: ['employee-number-capability', companyId, businessId, userId, branchId],
    enabled: branchId.length > 0,
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await apiClient().GET(
        '/v1/businesses/{businessId}/employee-number-capability',
        {
          params: {
            header: { 'x-company-id': companyId },
            path: { businessId },
            query: { primary_branch_id: branchId },
          },
          signal,
        },
      );
      if (result.error) throw { ...result.error, status: result.response.status };
      return employeeNumberCapability.parse(result.data);
    },
  });
}
