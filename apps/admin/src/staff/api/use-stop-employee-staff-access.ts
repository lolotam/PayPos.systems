'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import { employeeStaffAccessKey } from './use-employee-staff-access';

/** إيقاف دخول موظفة: العضوية تنتهي والجلسات تُنهى، والرد هو حالة STOPPED الملتزمة. */
export function useStopEmployeeStaffAccess(
  companyId: string,
  businessId: string,
  employeeId: string,
) {
  const client = useQueryClient();
  return useMutation({
    mutationKey: ['employee-staff-access-stop', companyId, businessId, employeeId],
    retry: false,
    mutationFn: async () => {
      const result = await apiClient().DELETE(
        '/v1/businesses/{businessId}/employees/{employeeId}/staff-access',
        {
          params: {
            header: { 'x-company-id': companyId },
            path: { businessId, employeeId },
          },
        },
      );
      if (result.error) throw result.error;
      return result.data;
    },
    onSuccess: async (state) => {
      // أي قراءة قديمة لسه طالعة ما لازمش تكتب فوق حالة الإيقاف الملتزمة (AC-ACT-10).
      const key = employeeStaffAccessKey(companyId, businessId, employeeId);
      await client.cancelQueries({ queryKey: key });
      client.setQueryData(key, state);
    },
  });
}
