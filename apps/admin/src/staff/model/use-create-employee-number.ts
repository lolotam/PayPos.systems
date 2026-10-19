'use client';
import type { CreateEmployeeInput } from '@pospay/contracts';
import { useEffect, type FormEvent } from 'react';
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

/** الحفظ أثناء التحميل بيضيع الرقم المكتوب؛ والمسودة الباطلة المخفية بتتشال قبل التحقق عشان ما توقفوش. */
export function submitCreateEmployeeForm(
  form: UseFormReturn<CreateEmployeeInput>,
  shown: boolean,
  pending: boolean,
  save: (values: CreateEmployeeInput) => void,
): (event: FormEvent<HTMLFormElement>) => void {
  return (event) => {
    if (pending) {
      event.preventDefault();
      return;
    }
    if (!shown) form.unregister('employee_number');
    void form.handleSubmit((values) => save(submitCreateEmployee(shown, values)))(event);
  };
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
  const shown = !capability.isError && capability.data?.can_type_number === true;
  // مفتاح الفرع الحالي لسه من غير رد؛ التحميل مش رفض، بس الحفظ يستنى عشان الرقم المكتوب ما يضيعش.
  const pending = branchId.length > 0 && !capability.isError && capability.data === undefined;
  const blocked = capability.isError || capability.data?.can_type_number === false;
  useEffect(() => {
    // التحميل بين فرعين مسموحين مش رفض؛ المسح هنا كان بيمسح الرقم قبل ما الفرع الجديد يرد.
    if (!blocked) return;
    form.unregister('employee_number');
  }, [blocked, form]);
  useEffect(() => {
    onVisibility?.(shown);
  }, [onVisibility, shown]);
  const message =
    shown && isEmployeeNumberRefusal(serverError, numberSent)
      ? envelopeMessage(serverError, locale)
      : null;
  return { shown, pending, message };
}
