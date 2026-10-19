'use client';
import { employeeNumberView, type EmployeeDetail, type EmployeePage } from '@pospay/contracts';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import { isEmployeeNumberForbidden } from '../model/typed-employee-number';

// نفس بادئة use-employees حتى يظهر الرقم في العنوان والقائمة من غير تصدير مفتاح القراءة.
function employeesRoot(companyId: string, businessId: string, userId: string) {
  return ['employees', companyId, businessId, userId] as const;
}

function rememberEmployeeNumber(
  client: QueryClient,
  companyId: string,
  businessId: string,
  userId: string,
  employeeId: string,
  employeeNumber: number,
) {
  const root = employeesRoot(companyId, businessId, userId);
  client.setQueryData<EmployeeDetail>([...root, 'detail', employeeId], (current) =>
    current ? { ...current, employee_number: employeeNumber } : current,
  );
  client.setQueriesData<EmployeePage>({ queryKey: [...root, 'list'] }, (current) =>
    current
      ? {
          ...current,
          items: current.items.map((item) =>
            item.id === employeeId ? { ...item, employee_number: employeeNumber } : item,
          ),
        }
      : current,
  );
  // الرقم الجديد ظاهر من الكاش؛ إعادة الجلب الفورية كانت بتستبدله لو الرد رجع قديماً أو اتعلّق.
  void client.invalidateQueries({ queryKey: [...root, 'list'], refetchType: 'none' });
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
