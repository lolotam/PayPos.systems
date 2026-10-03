'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  updateEmployeeInput,
  type EmployeeDetail,
  type UpdateEmployeeInput,
  type WorkspaceBranch,
} from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { FormProvider, useForm } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { EmployeeNameFields } from './employee-name-fields';
import { EmployeePlacementFields } from './employee-placement-fields';
import { EmployeeContractFields } from './employee-contract-fields';
import { EmployeeBranchFields } from './employee-branch-fields';

export function EditEmployeeForm({
  record,
  branches,
  pending,
  onSave,
}: {
  record: EmployeeDetail;
  branches: readonly WorkspaceBranch[];
  pending: boolean;
  onSave: (terms: UpdateEmployeeInput) => void;
}) {
  const locale = useLocale();
  const form = useForm<UpdateEmployeeInput>({
    resolver: zodResolver(updateEmployeeInput),
    defaultValues: {
      name_en: record.name_en,
      name_ar: record.name_ar,
      role_code: record.role_code,
      primary_branch_id: record.primary_branch_id,
      hire_date: record.hire_date,
      contract_end: record.contract_end,
      user_id: record.user_id,
      expected_revision: record.revision,
      branch_ids: record.branch_ids,
      branch_effective_date: '',
    },
  });
  return (
    <FormProvider {...form}>
      <form onSubmit={form.handleSubmit(onSave)} className="flex flex-col gap-3 text-start">
        <fieldset disabled={pending} className="flex flex-col gap-3">
          <EmployeeNameFields />
          <EmployeePlacementFields branches={branches} />
          <EmployeeContractFields />
          <EmployeeBranchFields branches={branches} />
          <Button type="submit">{t(locale, 'staff.save')}</Button>
        </fieldset>
        {Object.keys(form.formState.errors).length ? (
          <p role="alert">{t(locale, 'staff.invalid')}</p>
        ) : null}
      </form>
    </FormProvider>
  );
}
