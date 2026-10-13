'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { findOrCreateCustomerInput, type Customer, type FindOrCreateCustomerInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, Card, Input, Label } from '@pospay/ui';
import { useId } from 'react';
import { useForm } from 'react-hook-form';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useSessionCustomer } from '../api/use-session-customer';

export type SessionCustomerSelection = Pick<Customer, 'id' | 'name' | 'phone'>;

export function SessionCustomerField({ companyId, branchId, userId, value, onChange, onBlur, disabled = false }: {
  companyId: string; branchId: string; userId: string;
  value: SessionCustomerSelection | null;
  onChange: (value: SessionCustomerSelection | null) => void;
  onBlur?: () => void; disabled?: boolean;
}) {
  const locale = useLocale();
  const prefix = useId();
  const mutation = useSessionCustomer(companyId, branchId, userId);
  const form = useForm<FindOrCreateCustomerInput>({
    resolver: zodResolver(findOrCreateCustomerInput),
    defaultValues: { name: value?.name ?? '', phone: { calling_code: '', national_number: '' }, locale },
  });
  const invalidate = () => { onChange(null); mutation.reset(); };
  const resolve = form.handleSubmit(async (input) => {
    try {
      const saved = await mutation.mutateAsync({ ...input, locale });
      onChange({ id: saved.id, name: saved.name, phone: saved.phone });
      form.reset({ name: saved.name, phone: { calling_code: '', national_number: '' }, locale });
      mutation.reset();
    } catch { return; }
  });
  const invalid = Object.keys(form.formState.errors).length > 0;
  return <fieldset disabled={disabled || mutation.isPending || form.formState.isSubmitting} onBlur={onBlur} className="flex flex-col gap-3 text-start">
    <legend>{t(locale, 'serviceSessions.customer')}</legend>
    <Label htmlFor={`${prefix}-name`}>{t(locale, 'serviceSessions.name')}</Label>
    <Input id={`${prefix}-name`} autoComplete="off" aria-invalid={!!form.formState.errors.name}
      aria-describedby={invalid ? `${prefix}-error` : undefined} {...form.register('name', { onChange: invalidate })} />
    <Label htmlFor={`${prefix}-code`}>{t(locale, 'serviceSessions.callingCode')}</Label>
    <Input id={`${prefix}-code`} dir="ltr" inputMode="numeric" autoComplete="off"
      aria-invalid={!!form.formState.errors.phone?.calling_code} aria-describedby={invalid ? `${prefix}-error` : undefined}
      {...form.register('phone.calling_code', { onChange: invalidate })} />
    <Label htmlFor={`${prefix}-phone`}>{t(locale, 'serviceSessions.phone')}</Label>
    <Input id={`${prefix}-phone`} dir="ltr" type="tel" autoComplete="off"
      aria-invalid={!!form.formState.errors.phone?.national_number} aria-describedby={invalid ? `${prefix}-error` : undefined}
      {...form.register('phone.national_number', { onChange: invalidate })} />
    <Button type="button" disabled={!!value} onClick={() => void resolve()}>
      {t(locale, 'serviceSessions.findOrCreate')}
    </Button>
    {invalid ? <p id={`${prefix}-error`} role="alert">{t(locale, 'serviceSessions.invalidCustomer')}</p> : null}
    {mutation.isError ? <p role="alert">{envelopeMessage(mutation.error, locale)}</p> : null}
    {value ? <Card role="status" className="p-3">
      <p>{t(locale, 'serviceSessions.selected')}</p><p>{value.name}</p><bdi>{value.phone}</bdi>
    </Card> : null}
  </fieldset>;
}

