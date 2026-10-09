'use client';
import type { SetEmployeeIbanInput } from '@pospay/contracts';
import { bankForIbanCode, formatIbanForDisplay, validateIban } from '@pospay/domain';
import { t } from '@pospay/i18n';
import { Input, Label } from '@pospay/ui';
import { useWatch, type UseFormReturn } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';

export function IbanInput({ form }: { form: UseFormReturn<SetEmployeeIbanInput> }) {
  const locale = useLocale();
  const iban = useWatch({ control: form.control, name: 'iban' }) ?? '';
  const checked = validateIban(iban);
  const hint = checked.ok
    ? 'employeeIban.valid'
    : checked.reason === 'COUNTRY'
      ? 'employeeIban.country'
      : checked.reason === 'CHECKSUM'
        ? 'employeeIban.checksum'
        : 'employeeIban.format';
  return (
    <>
      <Label htmlFor="employee-iban">{t(locale, 'employeeIban.iban')}</Label>
      <Input
        id="employee-iban"
        dir="ltr"
        maxLength={64}
        {...form.register('iban', {
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
            const result = validateIban(event.target.value);
            form.setValue(
              'bank_id',
              result.ok ? (bankForIbanCode(result.country, result.bankCode)?.id ?? '') : '',
            );
          },
          onBlur: () => {
            if (checked.ok) form.setValue('iban', formatIbanForDisplay(checked.iban));
          },
        })}
      />
      {iban ? <p role="status">{t(locale, hint)}</p> : null}
    </>
  );
}
