'use client';
import {
  customer,
  findOrCreateCustomerInput,
  findOrCreateScopedCustomerInput,
  type FindOrCreateScopedCustomerInput,
} from '@pospay/contracts';
import { useCallback, useLayoutEffect, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import type { components } from '@/shared/api/schema';

export type SessionCustomerEntryScope = 'company' | 'business' | 'branch';

/** قيم النموذج بعد تنظيف الحقول الفاضية — نفس نوع العقد، مفيش تعريف تاني يتخلف عن السكيما. */
export type SessionCustomerFormValues = FindOrCreateScopedCustomerInput;

type CustomerBody = components['schemas']['FindOrCreateScopedCustomerInput'];

// كل نطاق بيستخدم عقده الصارم: مسار الشركة مالوش note، فالـ parse بيرفضها بدل ما تجيبها صامتة.
// عقد Zod بيسمح بـ undefined صراحةً، لكن جسم JSON والعميل المولّد بيمثلوا الغياب بحذف الخانة، بما فيها السنة الاختيارية.
function omitted(value: unknown): boolean {
  return value === '' || value === null || value === undefined;
}

function customerBody(input: SessionCustomerFormValues, scope: SessionCustomerEntryScope): CustomerBody {
  if (scope === 'company' && !omitted(input.note)) throw new Error('CUSTOMER_NOTE_NOT_ALLOWED');
  const { name, phone, locale, gender, birthday, email, note } = input;
  const identity = { name, phone, locale };
  const profileFields = {
    ...(omitted(gender) ? {} : { gender }),
    ...(omitted(email) ? {} : { email }),
    ...(birthday === undefined
      ? {}
      : {
          birthday: {
            day: birthday.day,
            month: birthday.month,
            ...(omitted(birthday.year) ? {} : { year: birthday.year }),
          },
        }),
  };
  const parsed =
    scope === 'company'
      ? findOrCreateCustomerInput.parse({ ...identity, ...profileFields })
      : findOrCreateScopedCustomerInput.parse({
          ...identity,
          ...profileFields,
          ...(omitted(note) ? {} : { note }),
        });
  const { gender: parsedGender, birthday: parsedBirthday, email: parsedEmail, ...rest } = parsed;
  const noteValue = scope === 'company' ? undefined : (parsed as { note?: string }).note;
  return {
    ...rest,
    ...(parsedGender === undefined ? {} : { gender: parsedGender }),
    ...(parsedEmail === undefined ? {} : { email: parsedEmail }),
    ...(parsedBirthday === undefined
      ? {}
      : {
          birthday: {
            day: parsedBirthday.day,
            month: parsedBirthday.month,
            ...(parsedBirthday.year === undefined ? {} : { year: parsedBirthday.year }),
          },
        }),
    ...(noteValue === undefined ? {} : { note: noteValue }),
  } as CustomerBody;
}

type CustomerEntry = {
  companyId: string;
  branchId: string;
  businessId: string | undefined;
  entryScope: SessionCustomerEntryScope;
};

async function postCustomer(entry: CustomerEntry, input: SessionCustomerFormValues) {
  const body = customerBody(input, entry.entryScope);
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
    mutationFn: async (input: SessionCustomerFormValues) => {
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
