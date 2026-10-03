'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { setSalaryInput, type SetSalaryInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import { useForm } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
export function SalaryForm({
  pending,
  onSave,
}: {
  pending: boolean;
  onSave: (input: SetSalaryInput) => void;
}) {
  const locale = useLocale();
  const form = useForm<SetSalaryInput>({
    resolver: zodResolver(setSalaryInput),
    defaultValues: { effective_from: '', amount: '', reason: '' },
  });
  return (
    <form onSubmit={form.handleSubmit(onSave)} className="flex flex-col gap-3 text-start">
      <fieldset disabled={pending} className="flex flex-col gap-3">
        <Label htmlFor="salary-date">{t(locale, 'salary.date')}</Label>
        <Input id="salary-date" type="date" {...form.register('effective_from')} />
        <Label htmlFor="salary-amount">{t(locale, 'salary.amount')}</Label>
        <Input id="salary-amount" inputMode="decimal" dir="ltr" {...form.register('amount')} />
        <Label htmlFor="salary-reason">{t(locale, 'salary.reason')}</Label>
        <Input id="salary-reason" maxLength={500} {...form.register('reason')} />
        <Button type="submit">{t(locale, 'salary.set')}</Button>
      </fieldset>
      {Object.keys(form.formState.errors).length > 0 ? (
        <p role="alert">{t(locale, 'salary.invalid')}</p>
      ) : null}
    </form>
  );
}
