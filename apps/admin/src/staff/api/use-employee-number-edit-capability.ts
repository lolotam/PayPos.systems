'use client';
import { employeeNumberEditCapability } from '@pospay/contracts';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';

export function employeeNumberEditCapabilityKey(
  companyId: string,
  userId: string,
  businessId: string,
  employeeId: string,
) {
  return ['employee-number-edit-capability', companyId, userId, businessId, employeeId] as const;
}

export function useEmployeeNumberEditCapability(
  companyId: string,
  businessId: string,
  userId: string,
  employeeId: string,
) {
  return useQuery({
    queryKey: employeeNumberEditCapabilityKey(companyId, userId, businessId, employeeId),
    enabled: employeeId.length > 0,
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await apiClient().GET(
        '/v1/businesses/{businessId}/employees/{employeeId}/employee-number-capability',
        {
          params: {
            header: { 'x-company-id': companyId },
            path: { businessId, employeeId },
          },
          signal,
        },
      );
      if (result.error) throw { ...result.error, status: result.response.status };
      return employeeNumberEditCapability.parse(result.data);
    },
  });
}
