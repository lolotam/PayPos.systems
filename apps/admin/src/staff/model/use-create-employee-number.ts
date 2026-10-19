'use client';
import type { CreateEmployeeInput } from '@pospay/contracts';
import { useEffect } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useEmployeeNumberCapability } from '../api/use-employee-number-capability';
import { isEmployeeNumberRefusal } from './typed-employee-number';

type NumberDraft = {
  companyId: string;
  businessId: string;
  userId: string;
  branchId: string;
  serverError: unknown;
  numberSent: boolean;
  onVisibility: ((shown: boolean) => void) | undefined;
  form: UseFormReturn<CreateEmployeeInput>;
};

/** الحقل المخفي لا يرسل رقماً حتى لو القيمة لسه في النموذج من فرع سابق. */
export function submitCreateEmployee(
  shown: boolean,
  values: CreateEmployeeInput,
): CreateEmployeeInput {
  if (shown && values.employee_number !== undefined) return values;
  const next = { ...values };
  delete next.employee_number;
  return next;
}

export function useCreateEmployeeNumber({
  companyId,
  businessId,
  userId,
  branchId,
  serverError,
  numberSent,
  onVisibility,
  form,
}: NumberDraft) {
  const locale = useLocale();
  const capability = useEmployeeNumberCapability(companyId, businessId, userId, branchId);
  const shown = capability.data?.can_type_number === true;
  const blocked = capability.isError || capability.data?.can_type_number === false;
  useEffect(() => {
    // التحميل بين فرعين مسموحين مش رفض؛ المسح هنا كان بيمسح الرقم قبل ما الفرع الجديد يرد.
    if (!blocked) return;
    form.resetField('employee_number');
  }, [blocked, form]);
  useEffect(() => {
    onVisibility?.(shown);
  }, [onVisibility, shown]);
  const message =
    shown && isEmployeeNumberRefusal(serverError, numberSent)
      ? envelopeMessage(serverError, locale)
      : null;
  return { shown, message };
}
