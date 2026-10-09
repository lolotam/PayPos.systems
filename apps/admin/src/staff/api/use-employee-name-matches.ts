'use client';
import { employeeNameMatches, type EmployeeNameMatchesInput } from '@pospay/contracts';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';

export function useEmployeeNameMatches(companyId: string, businessId: string) {
  return useMutation({
    mutationKey: ['employee-name-matches', companyId, businessId],
    retry: false,
    gcTime: 0,
    mutationFn: async (body: EmployeeNameMatchesInput) => {
      const result = await apiClient().POST('/v1/businesses/{businessId}/employees/name-matches', {
        params: { header: { 'x-company-id': companyId }, path: { businessId } },
        body: {
          name_en: body.name_en,
          name_ar: body.name_ar ?? null,
          ...(body.exclude_employee_id === undefined
            ? {}
            : { exclude_employee_id: body.exclude_employee_id }),
        },
        signal: AbortSignal.timeout(5_000),
      });
      if (result.error) throw result.error;
      return employeeNameMatches.parse(result.data);
    },
  });
}
