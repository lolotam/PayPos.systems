'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  setEmployeeIbanInput,
  type EmployeeIbanView,
  type SetEmployeeIbanInput,
} from '@pospay/contracts';
import {
  banksForCountry,
  formatIbanForDisplay,
  normalizeHolderName,
  validateIban,
} from '@pospay/domain';
import { t } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { BankingFields } from './iban-banking-fields';

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
    const holder_name_en = normalizeHolderName(input.holder_name_en ?? '');
    if (
      !result.ok ||
      !banksForCountry(result.country).some((bank) => bank.id === input.bank_id) ||
      holder_name_en === null
    ) {
      form.setError('iban', { type: 'validate' });
      return;
    }
    onSave({ ...input, iban: result.iban, holder_name_en });
  }
  return { form, submit };
}
