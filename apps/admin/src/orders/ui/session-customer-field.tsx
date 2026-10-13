'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { findOrCreateCustomerInput, type Customer, type FindOrCreateCustomerInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, Card, Input, Label } from '@pospay/ui';
import { useId, useLayoutEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useSessionCustomer } from '../api/use-session-customer';

export type SessionCustomerSelection = Pick<Customer, 'id' | 'name' | 'phone'>;

type SessionCustomerFieldProps = {
  companyId: string; branchId: string; userId: string;
  value: SessionCustomerSelection | null;
  onChange: (value: SessionCustomerSelection | null) => void;
  onBlur?: () => void; disabled?: boolean;
};
export function SessionCustomerField({ companyId, branchId, userId, value, onChange, onBlur, disabled = false }: SessionCustomerFieldProps) {
  const locale = useLocale();
  const prefix = useId();
  const mutation = useSessionCustomer(companyId, branchId, userId);
  const form = useForm<FindOrCreateCustomerInput>({
    resolver: zodResolver(findOrCreateCustomerInput),
    defaultValues: { name: value?.name ?? '', phone: { calling_code: '', national_number: '' }, locale },
  });
  const scope = JSON.stringify([companyId, branchId, userId]);
  const previousScope = useRef(scope);
  const { reset: resetEntry } = form; const { reset: resetMutation } = mutation;
  useLayoutEffect(() => {
    if (previousScope.current === scope) return;
    previousScope.current = scope; onChange(null);
    resetEntry({ name: '', phone: { calling_code: '', national_number: '' }, locale }); resetMutation();
  }, [scope, locale, onChange, resetEntry, resetMutation]);
  const observed = useRef(value), emitted = useRef<SessionCustomerSelection | null | undefined>(undefined);
  useLayoutEffect(() => {
    if (observed.current === value) return; observed.current = value;
    if (emitted.current !== value) { resetEntry({ name: value?.name ?? '', phone: { calling_code: '', national_number: '' }, locale }); resetMutation(); }
    emitted.current = undefined;
  }, [value, locale, resetEntry, resetMutation]);
  const publish = (next: SessionCustomerSelection | null) => { emitted.current = next; onChange(next); };
  const invalidate = () => { publish(null); mutation.reset(); };
  const resolve = () => { const captured = mutation.captureScope(); void form.handleSubmit(async (input) => {
    if (!mutation.isCurrentScope(captured)) return;
    try {
      const saved = await mutation.mutateAsync({ ...input, locale });
      if (!mutation.isCurrentScope(captured)) return;
      publish({ id: saved.id, name: saved.name, phone: saved.phone });
      form.reset({ name: saved.name, phone: { calling_code: '', national_number: '' }, locale });
      mutation.reset();
    } catch { return; }
  })(); };
  const invalid = Object.keys(form.formState.errors).length > 0; const nameEntry = form.register('name'), callingCode = form.register('phone.calling_code'), nationalNumber = form.register('phone.national_number');
  return <fieldset disabled={disabled || mutation.isPending || form.formState.isSubmitting} onBlur={onBlur} className="flex flex-col gap-3 text-start">
    <legend>{t(locale, 'serviceSessions.customer')}</legend>
    <Label htmlFor={`${prefix}-name`}>{t(locale, 'serviceSessions.name')}</Label>
    <Input id={`${prefix}-name`} autoComplete="off" aria-invalid={!!form.formState.errors.name}
      aria-describedby={invalid ? `${prefix}-error` : undefined} {...nameEntry} onChange={(event) => { void nameEntry.onChange(event); invalidate(); }} />
    <Label htmlFor={`${prefix}-code`}>{t(locale, 'serviceSessions.callingCode')}</Label>
    <Input id={`${prefix}-code`} dir="ltr" inputMode="numeric" autoComplete="off"
      aria-invalid={!!form.formState.errors.phone?.calling_code} aria-describedby={invalid ? `${prefix}-error` : undefined}
      {...callingCode} onChange={(event) => { void callingCode.onChange(event); invalidate(); }} />
    <Label htmlFor={`${prefix}-phone`}>{t(locale, 'serviceSessions.phone')}</Label>
    <Input id={`${prefix}-phone`} dir="ltr" type="tel" autoComplete="off"
      aria-invalid={!!form.formState.errors.phone?.national_number} aria-describedby={invalid ? `${prefix}-error` : undefined}
      {...nationalNumber} onChange={(event) => { void nationalNumber.onChange(event); invalidate(); }} />
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
