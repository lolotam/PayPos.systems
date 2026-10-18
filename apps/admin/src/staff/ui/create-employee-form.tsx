'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  createEmployeeInput,
  type CreateEmployeeInput,
  type WorkspaceBranch,
} from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { FormProvider, useForm, useWatch } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import {
  saveParsedEmployeeNumber,
  useCreateEmployeeNumber,
} from '../model/use-create-employee-number';
import { useNameCheckedSubmit } from '../model/use-name-checked-submit';
import { DuplicateNameWarning } from './duplicate-name-warning';
import { EmployeeContractFields } from './employee-contract-fields';
import { EmployeeNameFields } from './employee-name-fields';
import { EmployeeNumberField } from './employee-number-field';
import { EmployeePlacementFields } from './employee-placement-fields';

type CreateEmployeeFormProps = {
  companyId: string;
  businessId: string;
  userId: string;
  branches: readonly WorkspaceBranch[];
  pending: boolean;
  serverError?: unknown;
  onNumberVisibility?: (shown: boolean) => void;
  onSave: (terms: CreateEmployeeInput) => void;
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
  const submit = useNameCheckedSubmit(props.companyId, props.businessId, props.onSave);
  const form = useForm<CreateEmployeeInput>({
    resolver: zodResolver(createEmployeeInput),
    defaultValues: emptyEmployee(props.branches),
  });
  const branchId = useWatch({ control: form.control, name: 'primary_branch_id' });
  const number = useCreateEmployeeNumber({
    companyId: props.companyId,
    businessId: props.businessId,
    userId: props.userId,
    branchId: branchId ?? '',
    serverError: props.serverError ?? null,
    onVisibility: props.onNumberVisibility,
  });
  return (
    <FormProvider {...form}>
      <form
        onSubmit={form.handleSubmit(saveParsedEmployeeNumber(number.apply, submit.submit))}
        className="flex flex-col gap-3 text-start"
      >
        <fieldset
          disabled={props.pending || submit.checking || !!submit.warning}
          className="flex flex-col gap-3"
        >
          <EmployeeNameFields />
          <EmployeePlacementFields branches={props.branches} />
          <EmployeeContractFields />
          <EmployeeNumberField
            shown={number.shown}
            draft={number.draft}
            invalid={number.invalid}
            message={number.message}
            onChange={number.changeDraft}
          />
          <Button type="submit">{t(locale, 'staff.create')}</Button>
        </fieldset>
        {submit.warning ? (
          <DuplicateNameWarning
            matches={submit.warning}
            branches={props.branches}
            onEdit={submit.dismiss}
            onConfirm={submit.confirm}
          />
        ) : null}
        {Object.keys(form.formState.errors).length ? (
          <p role="alert">{t(locale, 'staff.invalid')}</p>
        ) : null}
      </form>
    </FormProvider>
  );
}
