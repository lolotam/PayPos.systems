'use client';
import { customer, findOrCreateCustomerInput, type FindOrCreateCustomerInput } from '@pospay/contracts';
import { useLayoutEffect, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';

export function useSessionCustomer(companyId: string, branchId: string, userId: string) {
  const epoch = useRef(0);
  useLayoutEffect(() => { epoch.current += 1; return () => { epoch.current += 1; }; }, [companyId, branchId, userId]);
  const mutation = useMutation({
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
  return { ...mutation, captureScope: () => epoch.current, isCurrentScope: (captured: number) => epoch.current === captured };
}
