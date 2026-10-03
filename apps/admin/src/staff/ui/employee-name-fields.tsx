'use client';
import type { CreateEmployeeInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Input, Label } from '@pospay/ui';
import { useFormContext } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';

export function EmployeeNameFields() {
  const locale = useLocale();
  const { register } = useFormContext<CreateEmployeeInput>();
  return (
    <>
      <Label htmlFor="employee-name-en">{t(locale, 'staff.nameEn')}</Label>
      <Input id="employee-name-en" dir="ltr" {...register('name_en')} />
      <Label htmlFor="employee-name-ar">{t(locale, 'staff.nameAr')}</Label>
      <Input
        id="employee-name-ar"
        dir="rtl"
        {...register('name_ar', {
          setValueAs: (v: unknown) => (typeof v === 'string' ? v.trim() || null : null),
        })}
      />
    </>
  );
}
