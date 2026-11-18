'use client';
import {
  customer,
  findOrCreateCustomerInput,
  type FindOrCreateCustomerInput,
} from '@pospay/contracts';
import { useCallback, useLayoutEffect, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import type { components } from '@/shared/api/schema';

export type SessionCustomerEntryScope = 'company' | 'business' | 'branch';

// عقد Zod بيسمح بـ undefined صراحةً، لكن جسم JSON والعميل المولّد بيمثلوا الغياب بحذف الخانة، بما فيها السنة الاختيارية.
function customerBody(
  input: FindOrCreateCustomerInput,
): components['schemas']['FindOrCreateScopedCustomerInput'] {
  const { gender, birthday, email, ...identity } = findOrCreateCustomerInput.parse(input);
  return {
    ...identity,
    ...(gender === undefined ? {} : { gender }),
    ...(email === undefined ? {} : { email }),
    ...(birthday === undefined
      ? {}
      : {
          birthday: {
            day: birthday.day,
            month: birthday.month,
            ...(birthday.year === undefined ? {} : { year: birthday.year }),
          },
        }),
  };
}

type CustomerEntry = {
  companyId: string;
  branchId: string;
  businessId: string | undefined;
  entryScope: SessionCustomerEntryScope;
};

async function postCustomer(entry: CustomerEntry, input: FindOrCreateCustomerInput) {
  const body = customerBody(input);
  const header = { 'x-company-id': entry.companyId };
  if (entry.entryScope === 'company') {
    return apiClient().POST('/v1/customers/find-or-create', {
      params: { header },
      body,
    });
  }
  if (entry.entryScope === 'business') {
    if (entry.businessId === undefined) throw new Error('CUSTOMER_BUSINESS_REQUIRED');
    return apiClient().POST('/v1/businesses/{businessId}/customers/find-or-create', {
      params: { header, path: { businessId: entry.businessId } },
      body,
    });
  }
  return apiClient().POST('/v1/branches/{branchId}/customers/find-or-create', {
    params: { header, path: { branchId: entry.branchId } },
    body,
  });
}

export function useSessionCustomer(
  companyId: string,
  branchId: string,
  userId: string,
  entryScope: SessionCustomerEntryScope = 'branch',
  businessId?: string,
) {
  const epoch = useRef(0);
  useLayoutEffect(() => {
    epoch.current += 1;
    return () => {
      epoch.current += 1;
    };
  }, [companyId, branchId, userId, entryScope, businessId]);
  const mutation = useMutation({
    mutationKey: ['session-customer', companyId, branchId, userId, entryScope, businessId],
    retry: false,
    gcTime: 0,
    mutationFn: async (input: FindOrCreateCustomerInput) => {
      const result = await postCustomer({ companyId, branchId, businessId, entryScope }, input);
      if (result.error) throw { ...result.error, status: result.response.status };
      return customer.parse(result.data);
    },
  });
  const reset = useCallback(() => {
    epoch.current += 1;
    mutation.reset();
  }, [mutation.reset]);
  return {
    ...mutation,
    reset,
    captureScope: () => epoch.current,
    isCurrentScope: (captured: number) => epoch.current === captured,
  };
}
