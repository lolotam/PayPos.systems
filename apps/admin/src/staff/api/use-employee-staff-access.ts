'use client';
import { staffAccessState, type StaffAccessState } from '@pospay/contracts';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';

/** مفتاح حالة دخول موظفة واحدة في كاش الاستعلام. */
export function employeeStaffAccessKey(
  companyId: string,
  businessId: string,
  employeeId: string,
) {
  return ['employee-staff-access', companyId, businessId, employeeId] as const;
}

async function readEmployeeStaffAccess(
  companyId: string,
  businessId: string,
  employeeId: string,
): Promise<StaffAccessState | null> {
  const result = await apiClient().GET(
    '/v1/businesses/{businessId}/employees/{employeeId}/staff-access',
    {
      params: {
        header: { 'x-company-id': companyId },
        path: { businessId, employeeId },
      },
    },
  );
  if (result.error) throw result.error;
  return result.data === null ? null : staffAccessState.parse(result.data);
}

/**
 * حالة دخول الموظفة للوحة: NONE يعني لا سجل، والـ 404 يظهر للموظفة غير الموجودة فينشال الطلب.
 */
export function useEmployeeStaffAccess(
  companyId: string,
  businessId: string,
  employeeId: string,
): UseQueryResult<StaffAccessState | null> {
  return useQuery({
    queryKey: employeeStaffAccessKey(companyId, businessId, employeeId),
    queryFn: () => readEmployeeStaffAccess(companyId, businessId, employeeId),
    retry: false,
    staleTime: 30_000,
  });
}
