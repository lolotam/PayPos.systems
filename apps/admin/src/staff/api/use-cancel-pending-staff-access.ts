'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import { employeeStaffAccessKey } from './use-employee-staff-access';

/** إلغاء سجل انتظار متجاوز: الحساب يُحذف والسجل يموت، والرد هو حالة NONE بعد الإلغاء. */
export function useCancelPendingStaffAccess(
  companyId: string,
  businessId: string,
  employeeId: string,
) {
  const client = useQueryClient();
  return useMutation({
    mutationKey: ['employee-staff-access-cancel', companyId, businessId, employeeId],
    retry: false,
    mutationFn: async () => {
      const result = await apiClient().DELETE(
        '/v1/businesses/{businessId}/employees/{employeeId}/staff-access/pending',
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
      // أي قراءة قديمة لسه طالعة ما لازمش تكتب فوق حالة الإلغاء الملتزمة.
      const key = employeeStaffAccessKey(companyId, businessId, employeeId);
      await client.cancelQueries({ queryKey: key });
      client.setQueryData(key, state);
    },
  });
}
