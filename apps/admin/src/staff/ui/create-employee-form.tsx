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

export function CreateEmployeeForm({
  branches,
  pending,
  onSave,
}: {
  branches: readonly WorkspaceBranch[];
  pending: boolean;
  onSave: (terms: CreateEmployeeInput) => void;
}) {
  const locale = useLocale();
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
      <form onSubmit={form.handleSubmit(onSave)} className="flex flex-col gap-3 text-start">
        <fieldset disabled={pending} className="flex flex-col gap-3">
          <EmployeeNameFields />
          <EmployeePlacementFields branches={branches} />
          <EmployeeContractFields />
          <Button type="submit">{t(locale, 'staff.create')}</Button>
        </fieldset>
        {Object.keys(form.formState.errors).length ? (
          <p role="alert">{t(locale, 'staff.invalid')}</p>
        ) : null}
      </form>
    </FormProvider>
  );
}
