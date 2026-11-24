'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  createEmployeeInput,
  type CreateEmployeeInput,
  type WorkspaceBranch,
} from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { FormProvider, useForm, useWatch } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import {
  submitCreateEmployee,
  submitCreateEmployeeForm,
  useCreateEmployeeNumber,
} from '../model/use-create-employee-number';
import { useNameCheckedSubmit } from '../model/use-name-checked-submit';
import { useResetAfterSave } from '../model/use-reset-after-save';
import { DuplicateNameWarning } from './duplicate-name-warning';
import { CreateEmployeeFormCard } from './create-employee-form-card';

type CreateEmployeeFormProps = {
  companyId: string;
  businessId: string;
  userId: string;
  branches: readonly WorkspaceBranch[];
  pending: boolean;
  serverError?: unknown;
  numberSent?: boolean;
  onNumberVisibility?: (shown: boolean) => void;
  onSave: (terms: CreateEmployeeInput) => void;
  /** نتيجة آخر إنشاء ناجح؛ أي قيمة جديدة تفرّغ النموذج وترجع التركيز لأول حقل. */
  saved?: unknown;
};

function emptyEmployee(branches: readonly WorkspaceBranch[]): CreateEmployeeInput {
  return {
    name_en: '',
    name_ar: null,
    role_code: 'staff',
    primary_branch_id: branches[0]?.id ?? '',
    hire_date: '',
    contract_end: null,
    user_id: null,
  };
}

export function CreateEmployeeForm(props: CreateEmployeeFormProps) {
  const locale = useLocale();
  const form = useForm<CreateEmployeeInput>({
    resolver: zodResolver(createEmployeeInput),
    defaultValues: emptyEmployee(props.branches),
  });
  useResetAfterSave(form, props.saved);
  const branchId = useWatch({ control: form.control, name: 'primary_branch_id' });
  const number = useCreateEmployeeNumber({
    companyId: props.companyId,
    businessId: props.businessId,
    userId: props.userId,
    branchId: branchId ?? '',
    serverError: props.serverError ?? null,
    numberSent: props.numberSent ?? false,
    onVisibility: props.onNumberVisibility,
    form,
  });
  // التأكيد بيبعت القيم المخزنة من أول حفظ؛ الرؤية الحالية هي اللي تقرر هل الرقم يتبعت.
  const submit = useNameCheckedSubmit(
    props.companyId,
    props.businessId,
    (values: CreateEmployeeInput) => props.onSave(submitCreateEmployee(number.shown, values)),
  );
  const otherError = Object.keys(form.formState.errors).some((key) => key !== 'employee_number');
  return (
    <FormProvider {...form}>
      <form
        onSubmit={submitCreateEmployeeForm(form, number.shown, number.pending, (values) =>
          submit.submit(values),
        )}
        className="grid gap-4 text-start"
      >
        <CreateEmployeeFormCard
          branches={props.branches}
          disabled={props.pending || submit.checking || !!submit.warning}
          numberShown={number.shown}
          numberHidden={number.pending}
          numberMessage={number.message}
        />
        {submit.warning ? (
          <DuplicateNameWarning
            matches={submit.warning}
            branches={props.branches}
            onEdit={submit.dismiss}
            onConfirm={submit.confirm}
          />
        ) : null}
        {otherError ? <p role="alert">{t(locale, 'staff.invalid')}</p> : null}
      </form>
    </FormProvider>
  );
}
