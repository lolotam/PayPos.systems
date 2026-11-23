'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import { employeeStaffAccessKey } from './use-employee-staff-access';

/**
 * منح الدخول: الرد هو الحالة بعد الالتزام، وإعادة المحاولة بعد أي فشل آمنة لأن الطلب مستأنف بمعرّف
 * العملية (FR-F1-6) — لذلك الإبطال يكفي ولا نحتفظ بأي شيء في الكاش.
 */
export function useGrantEmployeeAccess(
  companyId: string,
  businessId: string,
  employeeId: string,
) {
  const client = useQueryClient();
  return useMutation({
    mutationKey: ['employee-staff-access-grant', companyId, businessId, employeeId],
    retry: false,
    mutationFn: async (body: {
      phone: string;
      phone_confirmed: true;
      role: 'staff' | 'reception';
      pin: string;
    }) => {
      const result = await apiClient().POST(
        '/v1/businesses/{businessId}/employees/{employeeId}/staff-access',
        {
          params: {
            header: { 'x-company-id': companyId },
            path: { businessId, employeeId },
          },
          body,
        },
      );
      if (result.error) throw result.error;
      return result.data;
    },
    onSuccess: (state) => {
      client.setQueryData(employeeStaffAccessKey(companyId, businessId, employeeId), state);
    },
  });
}
