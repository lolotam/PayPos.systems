'use client';
import type { UpdateEmployeeInput, WorkspaceBranch } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Input, Label } from '@pospay/ui';
import { Controller, useFormContext } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';

export function EmployeeBranchFields({ branches }: { branches: readonly WorkspaceBranch[] }) {
  const locale = useLocale();
  const { control, register } = useFormContext<UpdateEmployeeInput>();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="font-semibold">{t(locale, 'staff.branches')}</legend>
      <Controller
        name="branch_ids"
        control={control}
        render={({ field }) => (
          <>
            {branches.map((branch) => (
              <Label
                key={branch.id}
                className="flex items-center gap-2"
                htmlFor={`employee-work-${branch.id}`}
              >
                <Input
                  type="checkbox"
                  id={`employee-work-${branch.id}`}
                  className="h-4 min-h-4 w-4 ps-0 pe-0 py-0 accent-primary"
                  checked={field.value.includes(branch.id)}
                  onChange={(event) =>
                    field.onChange(
                      event.target.checked
                        ? [...field.value, branch.id]
                        : field.value.filter((id) => id !== branch.id),
                    )
                  }
                />
                {locale === 'ar' ? (branch.name_ar ?? branch.name_en) : branch.name_en}
              </Label>
            ))}
          </>
        )}
      />
      <Label htmlFor="employee-branch-date">{t(locale, 'staff.effectiveDate')}</Label>
      <Input
        type="date"
        dir="ltr"
        id="employee-branch-date"
        aria-describedby="employee-history-hint"
        {...register('branch_effective_date')}
      />
      <p id="employee-history-hint" className="text-sm text-muted-foreground">
        {t(locale, 'staff.historyHint')}
      </p>
    </fieldset>
  );
}
