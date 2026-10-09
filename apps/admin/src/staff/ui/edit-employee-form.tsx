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
import { useNameCheckedSubmit } from '../model/use-name-checked-submit';
import { DuplicateNameWarning } from './duplicate-name-warning';

const defaultTerms = (record: EmployeeDetail): UpdateEmployeeInput => ({
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
});

export function EditEmployeeForm({
  companyId,
  businessId,
  record,
  branches,
  pending,
  onSave,
}: {
  companyId: string;
  businessId: string;
  record: EmployeeDetail;
  branches: readonly WorkspaceBranch[];
  pending: boolean;
  onSave: (terms: UpdateEmployeeInput) => void;
}) {
  const locale = useLocale();
  const submit = useNameCheckedSubmit(companyId, businessId, onSave, record);
  const form = useForm<UpdateEmployeeInput>({
    resolver: zodResolver(updateEmployeeInput),
    defaultValues: defaultTerms(record),
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
          <EmployeeBranchFields branches={branches} />
          <Button type="submit">{t(locale, 'staff.save')}</Button>
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
