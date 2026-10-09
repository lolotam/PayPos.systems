'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  setEmployeeIbanInput,
  type EmployeeIbanView,
  type SetEmployeeIbanInput,
} from '@pospay/contracts';
import {
  bankForIbanCode,
  banksForCountry,
  formatIbanForDisplay,
  validateIban,
} from '@pospay/domain';
import { t } from '@pospay/i18n';
import { Button, Input, Label, NativeSelect } from '@pospay/ui';
import { useState } from 'react';
import { useForm, useWatch, type UseFormReturn } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';

export function IbanForm({
  current,
  pending,
  onSave,
}: {
  current: EmployeeIbanView;
  pending: boolean;
  onSave: (input: SetEmployeeIbanInput) => void;
}) {
  const locale = useLocale();
  const [clearing, setClearing] = useState(false);
  const { form, submit } = useIbanForm(current, clearing, onSave);
  return (
    <form onSubmit={form.handleSubmit(submit)} className="flex flex-col gap-3 text-start">
      <fieldset disabled={pending} className="flex flex-col gap-3">
        {!clearing ? (
          <BankingFields form={form} />
        ) : (
          <p>{t(locale, 'employeeIban.confirmClear')}</p>
        )}
        <Label htmlFor="employee-iban-reason">{t(locale, 'employeeIban.reason')}</Label>
        <Input id="employee-iban-reason" maxLength={500} {...form.register('reason')} />
        <Button type="submit">
          {t(locale, clearing ? 'employeeIban.confirmClear' : 'employeeIban.save')}
        </Button>
        {current.status === 'SET' || clearing ? (
          <Button type="button" variant="outline" onClick={() => setClearing(!clearing)}>
            {t(locale, clearing ? 'employeeIban.cancel' : 'employeeIban.clear')}
          </Button>
        ) : null}
      </fieldset>
      {Object.keys(form.formState.errors).length ? (
        <p role="alert">{t(locale, 'employeeIban.invalid')}</p>
      ) : null}
    </form>
  );
}

function useIbanForm(
  current: EmployeeIbanView,
  clearing: boolean,
  onSave: (input: SetEmployeeIbanInput) => void,
) {
  const form = useForm<SetEmployeeIbanInput>({
    resolver: zodResolver(setEmployeeIbanInput),
    defaultValues: {
      iban: formatIbanForDisplay(current.iban ?? ''),
      bank_id: current.bank_id ?? '',
      holder_name_en: current.holder_name_en ?? '',
      reason: '',
      expected_revision: current.revision,
    },
  });
  function submit(input: SetEmployeeIbanInput) {
    if (clearing) {
      onSave({ ...input, iban: null, bank_id: null, holder_name_en: null });
      return;
    }
    const result = validateIban(input.iban ?? '');
    if (
      !result.ok ||
      !banksForCountry(result.country).some((bank) => bank.id === input.bank_id) ||
      !/^[A-Za-z][A-Za-z .'-]{0,99}$/.test((input.holder_name_en ?? '').trim().replace(/\s+/g, ' '))
    ) {
      form.setError('iban', { type: 'validate' });
      return;
    }
    onSave({ ...input, iban: result.iban });
  }
  return { form, submit };
}
function BankingFields({ form }: { form: UseFormReturn<SetEmployeeIbanInput> }) {
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
function IbanInput({ form }: { form: UseFormReturn<SetEmployeeIbanInput> }) {
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
