'use client';
import { customer, findOrCreateCustomerInput, type FindOrCreateCustomerInput } from '@pospay/contracts';
import { useCallback, useLayoutEffect, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import type { components } from '@/shared/api/schema';

// عقد Zod بيسمح بـ undefined صراحةً، لكن جسم JSON والعميل المولّد بيمثلوا الغياب بحذف الخانة، بما فيها السنة الاختيارية.
function customerBody(input: FindOrCreateCustomerInput): components['schemas']['FindOrCreateScopedCustomerInput'] {
  const { gender, birthday, email, ...identity } = findOrCreateCustomerInput.parse(input);
  return {
    ...identity,
    ...(gender === undefined ? {} : { gender }),
    ...(email === undefined ? {} : { email }),
    ...(birthday === undefined ? {} : {
      birthday: {
        day: birthday.day,
        month: birthday.month,
        ...(birthday.year === undefined ? {} : { year: birthday.year }),
      },
    }),
  };
}

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
        body: customerBody(input),
      });
      if (result.error) throw { ...result.error, status: result.response.status };
      return customer.parse(result.data);
    },
  });
  const reset = useCallback(() => { epoch.current += 1; mutation.reset(); }, [mutation.reset]);
  return { ...mutation, reset, captureScope: () => epoch.current, isCurrentScope: (captured: number) => epoch.current === captured };
}
