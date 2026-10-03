'use client';
import { employee, type CreateEmployeeInput } from '@pospay/contracts';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';

async function create(companyId: string, businessId: string, body: CreateEmployeeInput) {
  const response = await apiClient().POST('/v1/businesses/{businessId}/employees', {
    params: { header: { 'x-company-id': companyId }, path: { businessId } },
    body: {
      ...body,
      name_ar: body.name_ar ?? null,
      contract_end: body.contract_end ?? null,
      user_id: body.user_id ?? null,
    },
  });
  if (response.error) throw response.error;
  return employee.parse(response.data);
}
export function useCreateEmployee(companyId: string, businessId: string, userId: string) {
  return useMutation({
    mutationKey: ['create-employee', companyId, businessId, userId],
    mutationFn: (body: CreateEmployeeInput) => create(companyId, businessId, body),
  });
}
