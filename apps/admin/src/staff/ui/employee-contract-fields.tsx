'use client';
import type { CreateEmployeeInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Input, Label } from '@pospay/ui';
import { useFormContext } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { EmployeeFieldCell } from './employee-field-cell';

export function EmployeeContractFields({ grid = false }: { grid?: boolean }) {
  const locale = useLocale();
  const { register } = useFormContext<CreateEmployeeInput>();
  const optional = {
    setValueAs: (v: unknown) => (typeof v === 'string' ? v.trim() || null : null),
  };
  return (
    <>
      <EmployeeFieldCell grid={grid} span={4}>
        <Label htmlFor="employee-hire">{t(locale, 'staff.hireDate')}</Label>
        <Input id="employee-hire" type="date" dir="ltr" {...register('hire_date')} />
      </EmployeeFieldCell>
      <EmployeeFieldCell grid={grid} span={4}>
        <Label htmlFor="employee-end">{t(locale, 'staff.contractEnd')}</Label>
        <Input id="employee-end" type="date" dir="ltr" {...register('contract_end', optional)} />
      </EmployeeFieldCell>
      <EmployeeFieldCell grid={grid} span={12}>
        <Label htmlFor="employee-user">{t(locale, 'staff.userId')}</Label>
        <Input id="employee-user" dir="ltr" {...register('user_id', optional)} />
      </EmployeeFieldCell>
    </>
  );
}
