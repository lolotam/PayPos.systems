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

async function postCustomer(
  entry: CustomerEntry,
  input: SessionCustomerFormValues,
  signal: AbortSignal,
) {
  const body = customerBody(input, entry.entryScope);
  const header = { 'x-company-id': entry.companyId };
  if (entry.entryScope === 'company') {
    return apiClient().POST('/v1/customers/find-or-create', { params: { header }, body, signal });
  }
  if (entry.entryScope === 'business') {
    if (entry.businessId === undefined) throw new Error('CUSTOMER_BUSINESS_REQUIRED');
    return apiClient().POST('/v1/businesses/{businessId}/customers/find-or-create', {
      params: { header, path: { businessId: entry.businessId } },
      body,
      signal,
    });
  }
  return apiClient().POST('/v1/branches/{branchId}/customers/find-or-create', {
    params: { header, path: { branchId: entry.branchId } },
    body,
    signal,
  });
}

function supersede(
  epoch: { current: number },
  pending: { current: AbortController | null },
) {
  epoch.current += 1;
  pending.current?.abort();
  pending.current = null;
}

export function useSessionCustomer(
  companyId: string,
  branchId: string,
  userId: string,
  entryScope: SessionCustomerEntryScope = 'branch',
  businessId?: string,
  online: boolean | null = true,
) {
  const epoch = useRef(0);
  const pending = useRef<AbortController | null>(null);
  // ما نعتمدش على قيمة الرندر وقت الإرسال؛ المستخدم ممكن ينقطع بين الضغط وبدء الطلب.
  const onlineRef = useRef(online);
  onlineRef.current = online;
  useLayoutEffect(() => {
    return () => supersede(epoch, pending);
  }, [companyId, branchId, userId, entryScope, businessId]);
  const mutation = useMutation({
    mutationKey: ['session-customer', companyId, branchId, userId, entryScope, businessId],
    retry: false,
    gcTime: 0,
    // طلب موقوف قبل بدء mutationFn مفيش AbortController يتلغي؛ نخليه يفشل فوراً بدل ما يتبعت عند رجوع النت.
    networkMode: 'always',
    mutationFn: async ({ input, startedIn }: { input: SessionCustomerFormValues; startedIn: number }) => {
      // كل طلب يحتفظ بنطاقه من لحظة الجدولة، حتى لو المستخدم بدأ طلب أحدث بعد إعادة الضبط.
      if (startedIn !== epoch.current) throw { code: 'STALE_SCOPE', status: 0 };
      // فحص قبل النقل: مفيش enqueue ولا replay، والطلب ما يبدأش وهو offline — حتى لو الرندر لسه ما اتحدّثش.
      if (onlineRef.current !== true || (typeof navigator !== 'undefined' && !navigator.onLine))
        throw { code: 'OFFLINE', status: 0 };
      // طلب واحد فقط في الطيران؛ الجديد يلغي القديم بدل ما يسيب controller بلا مالك.
      pending.current?.abort();
      const controller = new AbortController();
      pending.current = controller;
      try {
        const result = await postCustomer({ companyId, branchId, businessId, entryScope }, input, controller.signal);
        if (result.error) throw { ...result.error, status: result.response.status };
        return customer.parse(result.data);
      } finally {
        if (pending.current === controller) pending.current = null;
      }
    },
  });
  const reset = useCallback(() => {
    supersede(epoch, pending);
    mutation.reset();
  }, [mutation.reset]);
  return {
    error: mutation.error,
    isError: mutation.isError,
    isPending: mutation.isPending,
    mutateAsync: (input: SessionCustomerFormValues) =>
      mutation.mutateAsync({ input, startedIn: epoch.current }),
    reset,
    captureScope: () => epoch.current,
    isCurrentScope: (captured: number) => epoch.current === captured,
  };
}
