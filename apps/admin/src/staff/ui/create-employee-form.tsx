'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  createEmployeeInput,
  type CreateEmployeeInput,
  type WorkspaceBranch,
} from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { FormProvider, useForm } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { EmployeeNameFields } from './employee-name-fields';
import { EmployeePlacementFields } from './employee-placement-fields';
import { EmployeeContractFields } from './employee-contract-fields';
import { useNameCheckedSubmit } from '../model/use-name-checked-submit';
import { DuplicateNameWarning } from './duplicate-name-warning';

export function CreateEmployeeForm({
  companyId,
  businessId,
  branches,
  pending,
  onSave,
}: {
  companyId: string;
  businessId: string;
  branches: readonly WorkspaceBranch[];
  pending: boolean;
  onSave: (terms: CreateEmployeeInput) => void;
}) {
  const locale = useLocale();
  const submit = useNameCheckedSubmit(companyId, businessId, onSave);
  const form = useForm<CreateEmployeeInput>({
    resolver: zodResolver(createEmployeeInput),
    defaultValues: {
      name_en: '',
      name_ar: null,
      role_code: 'staff',
      primary_branch_id: branches[0]?.id ?? '',
      hire_date: '',
      contract_end: null,
      user_id: null,
    },
  });
  return (
    <FormProvider {...form}>
      <form onSubmit={form.handleSubmit(submit.submit)} className="flex flex-col gap-3 text-start">
        <fieldset
          disabled={pending || submit.checking || !!submit.warning}
          className="flex flex-col gap-3"
        >
          <EmployeeNameFields />
          <EmployeePlacementFields branches={branches} />
          <EmployeeContractFields />
          <Button type="submit">{t(locale, 'staff.create')}</Button>
        </fieldset>
        {submit.warning ? (
          <DuplicateNameWarning
            matches={submit.warning}
            branches={branches}
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
