'use client';
import type { CreateEmployeeInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Input, Label } from '@pospay/ui';
import { useFormContext } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { createEmployeeNumberFieldOptions } from '../model/employee-number-form-schema';
import { employeeNumberSaveAlert } from '../model/employee-number-save-alert';

export function EmployeeNumberField({
  shown,
  hidden,
  message,
}: {
  shown: boolean;
  hidden: boolean;
  message: string | null;
}) {
  const locale = useLocale();
  const form = useFormContext<CreateEmployeeInput>();
  // إعادة التركيب أثناء انتظار القدرة بتمرّر الرقم المخزّن من جديد؛ يفضل مركّب ومتخفي لحد الرد.
  if (!shown && !hidden) return null;
  const alert = employeeNumberSaveAlert(
    form.formState.errors.employee_number,
    message,
    t(locale, 'staff.numberInvalid'),
    message ?? '',
  );
  return (
    <div hidden={hidden}>
      <Label htmlFor="employee-number">{t(locale, 'staff.employeeNumber')}</Label>
      <Input
        id="employee-number"
        dir="ltr"
        inputMode="numeric"
        {...form.register('employee_number', createEmployeeNumberFieldOptions)}
      />
      <p className="text-sm text-muted-foreground">{t(locale, 'staff.numberHint')}</p>
      {alert ? <p role="alert">{alert}</p> : null}
    </div>
  );
}
