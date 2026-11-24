'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { commissionStatementPaidMethod, markCommissionStatementPaidInput, type MarkCommissionStatementPaidInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, Input, Label, NativeSelect } from '@pospay/ui';
import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { defaultPaymentDate, paymentMethodKeys } from '../model/statement-payment';

const NS = 'commissionStatementScreen';

export function StatementPayForm(props: {
  pending: boolean;
  onSubmit(body: MarkCommissionStatementPaidInput): void;
  onCancel(): void;
  children: ReactNode;
}) {
  const { pending, onSubmit, onCancel, children } = props;
  const locale = useLocale();
  const form = useForm<MarkCommissionStatementPaidInput>({
    resolver: zodResolver(markCommissionStatementPaidInput), mode: 'onChange',
    defaultValues: { paid_method: 'WITH_SALARY', paid_on: defaultPaymentDate(new Date()) },
  });
  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-3">
      <Label htmlFor="statement-paid-method">{t(locale, `${NS}.paidMethod`)}</Label>
      <NativeSelect id="statement-paid-method" disabled={pending} {...form.register('paid_method')}>
        {commissionStatementPaidMethod.options.map((method) => (
          <option key={method} value={method}>{t(locale, paymentMethodKeys[method])}</option>
        ))}
      </NativeSelect>
      <Label htmlFor="statement-paid-on">{t(locale, `${NS}.paidOn`)}</Label>
      <Input id="statement-paid-on" type="date" disabled={pending} aria-describedby="statement-paid-on-hint"
        aria-invalid={form.formState.errors.paid_on !== undefined} {...form.register('paid_on')} />
      <p id="statement-paid-on-hint">{t(locale, `${NS}.paidOnHint`)}</p>
      <Label htmlFor="statement-paid-note">{t(locale, `${NS}.paidNote`)}</Label>
      <textarea id="statement-paid-note" rows={3} disabled={pending} aria-describedby="statement-paid-note-hint"
        aria-invalid={form.formState.errors.paid_note !== undefined}
        className="rounded-interactive border border-input bg-background ps-3 pe-3 py-2"
        {...form.register('paid_note', { setValueAs: (note: string) => note.trim() === '' ? undefined : note })} />
      <p id="statement-paid-note-hint">{t(locale, `${NS}.paidNoteHint`)}</p>
      {Object.keys(form.formState.errors).length > 0 ? <p role="alert">{t(locale, `${NS}.errPaymentValidation`)}</p> : null}
      {children}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={!form.formState.isValid || pending}>
          {t(locale, pending ? `${NS}.working` : `${NS}.confirm`)}
        </Button>
        <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>{t(locale, `${NS}.cancel`)}</Button>
      </div>
    </form>
  );
}
