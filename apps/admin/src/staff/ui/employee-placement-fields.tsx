'use client';
import {
  employeeRoleCode,
  type CreateEmployeeInput,
  type WorkspaceBranch,
} from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Label, Select } from '@pospay/ui';
import { Controller, useFormContext } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { displayName } from '@/workspace/model/display-name';

export function EmployeePlacementFields({ branches }: { branches: readonly WorkspaceBranch[] }) {
  const locale = useLocale();
  const { control } = useFormContext<CreateEmployeeInput>();
  return (
    <>
      <Label htmlFor="employee-branch">{t(locale, 'staff.primaryBranch')}</Label>
      <Controller
        name="primary_branch_id"
        control={control}
        render={({ field }) => (
          <Select
            id="employee-branch"
            value={field.value}
            onValueChange={field.onChange}
            placeholder={t(locale, 'admin.chooseBranch')}
            options={branches.map((branch) => ({
              value: branch.id,
              label: displayName(branch, locale),
            }))}
          />
        )}
      />
      <Label htmlFor="employee-role">{t(locale, 'staff.role')}</Label>
      <Controller
        name="role_code"
        control={control}
        render={({ field }) => (
          <Select
            id="employee-role"
            value={field.value}
            onValueChange={field.onChange}
            options={employeeRoleCode.options.map((role) => ({
              value: role,
              label: t(locale, `roles.${role}`),
            }))}
          />
        )}
      />
    </>
  );
}
