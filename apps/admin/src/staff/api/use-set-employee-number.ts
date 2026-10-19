'use client';
import { employeeNumberView, type EmployeeDetail } from '@pospay/contracts';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import { applySavedEmployeeLists } from '../model/saved-number-page';
import { isEmployeeNumberForbidden } from '../model/typed-employee-number';

// نفس بادئة use-employees حتى يظهر الرقم في العنوان والقائمة من غير تصدير مفتاح القراءة.
function employeesRoot(companyId: string, businessId: string, userId: string) {
  return ['employees', companyId, businessId, userId] as const;
}

async function rememberEmployeeNumber(
  client: QueryClient,
  companyId: string,
  businessId: string,
  userId: string,
  employeeId: string,
  employeeNumber: number,
) {
  const root = employeesRoot(companyId, businessId, userId);
  const detailKey = [...root, 'detail', employeeId];
  // رد أقدم لسه في الطريق بيتلغى قبل الكتابة، عشان ما يرجعش يمسح الرقم الجديد.
  await client.cancelQueries({ queryKey: detailKey });
  await client.cancelQueries({ queryKey: [...root, 'list'] });
  client.setQueryData<EmployeeDetail>(detailKey, (current) =>
    current ? { ...current, employee_number: employeeNumber } : current,
  );
  applySavedEmployeeLists(client, root, employeeId, employeeNumber);
  void client.invalidateQueries({ queryKey: detailKey });
  void client.invalidateQueries({ queryKey: [...root, 'list'] });
  void client.invalidateQueries({ queryKey: ['employee-numbers', companyId] });
  // نفس شاشة الأرقام: نسخ الحضور والمؤدين المقفولة بتتشال، والمفتوحة بتتجاب من غير انتظار.
  for (const prefix of ['attendance-actions', 'session-performers', 'session-performer-facts']) {
    client.removeQueries({ queryKey: [prefix, companyId], type: 'inactive' });
    void client.invalidateQueries({ queryKey: [prefix, companyId] });
  }
}

export function useSetEmployeeNumber(
  companyId: string,
  businessId: string,
  userId: string,
  employeeId: string,
) {
  const client = useQueryClient();
  return useMutation({
    mutationKey: [...employeesRoot(companyId, businessId, userId), 'number', employeeId],
    retry: false,
    mutationFn: async (employeeNumber: number) => {
      const result = await apiClient().PUT(
        '/v1/businesses/{businessId}/employees/{employeeId}/employee-number',
        {
          params: {
            header: { 'x-company-id': companyId },
            path: { businessId, employeeId },
          },
          body: { employee_number: employeeNumber },
        },
      );
      if (result.error) throw result.error;
      return employeeNumberView.parse(result.data);
    },
    onSuccess: (saved) =>
      rememberEmployeeNumber(
        client,
        companyId,
        businessId,
        userId,
        employeeId,
        saved.employee_number,
      ),
    onError: (error) => {
      if (!isEmployeeNumberForbidden(error)) return;
      void client.invalidateQueries({
        queryKey: ['employee-number-capability', companyId, businessId],
      });
    },
  });
}
