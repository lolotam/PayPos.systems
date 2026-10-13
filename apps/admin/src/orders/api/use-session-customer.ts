'use client';
import { customer, findOrCreateCustomerInput, type FindOrCreateCustomerInput } from '@pospay/contracts';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';

export function useSessionCustomer(companyId: string, branchId: string, userId: string) {
  return useMutation({
    mutationKey: ['session-customer', companyId, branchId, userId],
    retry: false,
    gcTime: 0,
    mutationFn: async (input: FindOrCreateCustomerInput) => {
      const result = await apiClient().POST('/v1/branches/{branchId}/customers/find-or-create', {
        params: { header: { 'x-company-id': companyId }, path: { branchId } },
        body: findOrCreateCustomerInput.parse(input),
      });
      if (result.error) throw { ...result.error, status: result.response.status };
      return customer.parse(result.data);
    },
  });
}
