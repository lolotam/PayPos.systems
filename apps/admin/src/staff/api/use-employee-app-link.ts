'use client';

import { employeeAppLink } from '@pospay/contracts';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';

export function employeeAppLinkKey(companyId: string, userId: string, businessId: string) {
  return ['employee-app-link', companyId, userId, businessId] as const;
}

export function useEmployeeAppLink(
  companyId: string | undefined,
  userId: string | null,
  businessId: string | undefined,
) {
  return useQuery({
    queryKey: employeeAppLinkKey(companyId ?? '', userId ?? '', businessId ?? ''),
    retry: false,
    enabled: Boolean(companyId && userId && businessId),
    queryFn: async ({ signal }) => {
      const result = await apiClient().GET('/v1/businesses/{businessId}/staff/employee-app-link', {
        params: {
          header: { 'x-company-id': companyId ?? '' },
          path: { businessId: businessId ?? '' },
        },
        signal,
      });
      if (result.error) throw { ...result.error, status: result.response.status };
      return employeeAppLink.parse(result.data);
    },
  });
}
