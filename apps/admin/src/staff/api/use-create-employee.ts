'use client';
import { employee, type CreateEmployeeInput } from '@pospay/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import { isEmployeeNumberForbidden } from '../model/typed-employee-number';

async function create(companyId: string, businessId: string, body: CreateEmployeeInput) {
  const { employee_number: employeeNumber, ...terms } = body;
  const response = await apiClient().POST('/v1/businesses/{businessId}/employees', {
    params: { header: { 'x-company-id': companyId }, path: { businessId } },
    body: {
      ...terms,
      name_ar: terms.name_ar ?? null,
      contract_end: terms.contract_end ?? null,
      user_id: terms.user_id ?? null,
      ...(employeeNumber === undefined ? {} : { employee_number: employeeNumber }),
    },
  });
  if (response.error) throw response.error;
  return employee.parse(response.data);
}
export function useCreateEmployee(companyId: string, businessId: string, userId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationKey: ['create-employee', companyId, businessId, userId],
    mutationFn: (body: CreateEmployeeInput) => create(companyId, businessId, body),
    onSuccess: () => {
      // حوار بداية الترقيم بيعرض الرقم الجاي من الكاش؛ موظف جديد بيزحزحه.
      void client.invalidateQueries({ queryKey: ['employee-numbering', companyId] });
    },
    onError: (error, variables) => {
      if (variables.employee_number === undefined || !isEmployeeNumberForbidden(error)) return;
      void client.invalidateQueries({
        queryKey: ['employee-number-capability', companyId, businessId],
      });
    },
  });
}
