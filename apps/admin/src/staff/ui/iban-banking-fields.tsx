'use client';
import type { SetEmployeeIbanInput } from '@pospay/contracts';
import { banksForCountry, validateIban } from '@pospay/domain';
import { t } from '@pospay/i18n';
import { Input, Label, NativeSelect } from '@pospay/ui';
import { useWatch, type UseFormReturn } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { IbanInput } from './iban-input';

export function BankingFields({ form }: { form: UseFormReturn<SetEmployeeIbanInput> }) {
  const locale = useLocale();
  const checked = validateIban(useWatch({ control: form.control, name: 'iban' }) ?? '');
  const banks = checked.ok ? banksForCountry(checked.country) : [];
  return (
    <>
      <IbanInput form={form} />
      <Label htmlFor="employee-iban-bank">{t(locale, 'employeeIban.bank')}</Label>
      <NativeSelect id="employee-iban-bank" {...form.register('bank_id')}>
        <option value="">{t(locale, 'employeeIban.selectBank')}</option>
        {banks.map((bank) => (
          <option key={bank.id} value={bank.id}>
            {locale === 'ar' ? bank.nameAr : bank.nameEn}
          </option>
        ))}
      </NativeSelect>
      <Label htmlFor="employee-iban-holder">{t(locale, 'employeeIban.holder')}</Label>
      <Input
        id="employee-iban-holder"
        dir="ltr"
        maxLength={100}
        {...form.register('holder_name_en')}
      />
    </>
  );
}
