'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  findOrCreateCustomerInput,
  type Customer,
  type FindOrCreateCustomerInput,
} from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, Card, Input, Label } from '@pospay/ui';
import { useId, useLayoutEffect, useRef } from 'react';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useSessionCustomer } from '../api/use-session-customer';

export type SessionCustomerSelection = Pick<Customer, 'id' | 'name' | 'phone'>;

type SessionCustomerFieldProps = {
  companyId: string;
  branchId: string;
  userId: string;
  value: SessionCustomerSelection | null;
  onChange: (value: SessionCustomerSelection | null) => void;
  onBlur?: () => void;
  disabled?: boolean;
};
type SessionCustomerLocale = FindOrCreateCustomerInput['locale'];
type SessionCustomerForm = UseFormReturn<FindOrCreateCustomerInput>;
type SessionCustomerMutation = ReturnType<typeof useSessionCustomer>;
type SessionCustomerRegistration = ReturnType<SessionCustomerForm['register']>;
type PublishSessionCustomer = (next: SessionCustomerSelection | null) => void;
type SessionCustomerEntryOptions = Omit<SessionCustomerFieldProps, 'onBlur' | 'disabled'> & {
  locale: SessionCustomerLocale;
};
type SessionCustomerSynchronizationOptions = {
  form: SessionCustomerForm;
  mutation: SessionCustomerMutation;
  scope: string;
  locale: SessionCustomerLocale;
  value: SessionCustomerSelection | null;
  onChange: (value: SessionCustomerSelection | null) => void;
};
type SessionCustomerResolutionOptions = {
  form: SessionCustomerForm;
  mutation: SessionCustomerMutation;
  locale: SessionCustomerLocale;
  publish: PublishSessionCustomer;
};
type SessionCustomerContactOptions = {
  prefix: string;
  locale: SessionCustomerLocale;
  form: SessionCustomerForm;
  invalid: boolean;
  nameEntry: SessionCustomerRegistration;
  callingCode: SessionCustomerRegistration;
  nationalNumber: SessionCustomerRegistration;
  invalidate: () => void;
};

function customerEntry(name: string, locale: SessionCustomerLocale): FindOrCreateCustomerInput {
  return { name, phone: { calling_code: '', national_number: '' }, locale };
}

function useSessionCustomerSynchronization({
  form,
  mutation,
  scope,
  locale,
  value,
  onChange,
}: SessionCustomerSynchronizationOptions): PublishSessionCustomer {
  const previousScope = useRef(scope);
  const { reset: resetEntry } = form;
  const { reset: resetMutation } = mutation;
  useLayoutEffect(() => {
    if (previousScope.current === scope) return;
    previousScope.current = scope;
    onChange(null);
    resetEntry(customerEntry('', locale));
    resetMutation();
  }, [scope, locale, onChange, resetEntry, resetMutation]);
  const observed = useRef(value),
    emitted = useRef<SessionCustomerSelection | null | undefined>(undefined);
  useLayoutEffect(() => {
    if (observed.current === value) return;
    observed.current = value;
    if (emitted.current !== value) {
      resetEntry(customerEntry(value?.name ?? '', locale));
      resetMutation();
    }
    emitted.current = undefined;
  }, [value, locale, resetEntry, resetMutation]);
  return (next) => {
    emitted.current = next;
    onChange(next);
  };
}

function useSessionCustomerResolution({
  form,
  mutation,
  locale,
  publish,
}: SessionCustomerResolutionOptions) {
  return () => {
    const captured = mutation.captureScope();
    void form.handleSubmit(async (input) => {
      if (!mutation.isCurrentScope(captured)) return;
      try {
        const saved = await mutation.mutateAsync({ ...input, locale });
        if (!mutation.isCurrentScope(captured)) return;
        publish({ id: saved.id, name: saved.name, phone: saved.phone });
        form.reset(customerEntry(saved.name, locale));
        mutation.reset();
      } catch {
        return;
      }
    })();
  };
}

function useSessionCustomerEntry({
  companyId,
  branchId,
  userId,
  value,
  onChange,
  locale,
}: SessionCustomerEntryOptions) {
  const mutation = useSessionCustomer(companyId, branchId, userId);
  const form = useForm<FindOrCreateCustomerInput>({
    resolver: zodResolver(findOrCreateCustomerInput),
    defaultValues: customerEntry(value?.name ?? '', locale),
  });
  const scope = JSON.stringify([companyId, branchId, userId]);
  const publish = useSessionCustomerSynchronization({
    form,
    mutation,
    scope,
    locale,
    value,
    onChange,
  });
  const resolve = useSessionCustomerResolution({ form, mutation, locale, publish });
  const invalidate = () => {
    publish(null);
    mutation.reset();
  };
  const invalid = Object.keys(form.formState.errors).length > 0;
  const nameEntry = form.register('name'),
    callingCode = form.register('phone.calling_code'),
    nationalNumber = form.register('phone.national_number');
  return {
    form,
    mutation,
    invalid,
    nameEntry,
    callingCode,
    nationalNumber,
    resolve,
    invalidate,
  };
}

function sessionCustomerContact({
  prefix,
  locale,
  form,
  invalid,
  nameEntry,
  callingCode,
  nationalNumber,
  invalidate,
}: SessionCustomerContactOptions) {
  return (
    <>
      <Label htmlFor={`${prefix}-name`}>{t(locale, 'serviceSessions.name')}</Label>
      <Input
        id={`${prefix}-name`}
        autoComplete="off"
        aria-invalid={!!form.formState.errors.name}
        aria-describedby={invalid ? `${prefix}-error` : undefined}
        {...nameEntry}
        onChange={(event) => {
          void nameEntry.onChange(event);
          invalidate();
        }}
      />
      <Label htmlFor={`${prefix}-code`}>{t(locale, 'serviceSessions.callingCode')}</Label>
      <Input
        id={`${prefix}-code`}
        dir="ltr"
        inputMode="numeric"
        autoComplete="off"
        aria-invalid={!!form.formState.errors.phone?.calling_code}
        aria-describedby={invalid ? `${prefix}-error` : undefined}
        {...callingCode}
        onChange={(event) => {
          void callingCode.onChange(event);
          invalidate();
        }}
      />
      <Label htmlFor={`${prefix}-phone`}>{t(locale, 'serviceSessions.phone')}</Label>
      <Input
        id={`${prefix}-phone`}
        dir="ltr"
        type="tel"
        autoComplete="off"
        aria-invalid={!!form.formState.errors.phone?.national_number}
        aria-describedby={invalid ? `${prefix}-error` : undefined}
        {...nationalNumber}
        onChange={(event) => {
          void nationalNumber.onChange(event);
          invalidate();
        }}
      />
    </>
  );
}

function sessionCustomerCard(
  value: SessionCustomerSelection | null,
  locale: SessionCustomerLocale,
) {
  if (!value) return null;
  return (
    <Card role="status" className="p-3">
      <p>{t(locale, 'serviceSessions.selected')}</p>
      <p>{value.name}</p>
      <bdi>{value.phone}</bdi>
    </Card>
  );
}

export function SessionCustomerField({
  companyId,
  branchId,
  userId,
  value,
  onChange,
  onBlur,
  disabled = false,
}: SessionCustomerFieldProps) {
  const locale = useLocale();
  const prefix = useId();
  const { form, mutation, invalid, nameEntry, callingCode, nationalNumber, resolve, invalidate } =
    useSessionCustomerEntry({ companyId, branchId, userId, value, onChange, locale });
  return (
    <fieldset
      disabled={disabled || mutation.isPending || form.formState.isSubmitting}
      onBlur={onBlur}
      className="flex flex-col gap-3 text-start"
    >
      <legend>{t(locale, 'serviceSessions.customer')}</legend>
      {sessionCustomerContact({
        prefix,
        locale,
        form,
        invalid,
        nameEntry,
        callingCode,
        nationalNumber,
        invalidate,
      })}
      <Button type="button" disabled={!!value} onClick={() => void resolve()}>
        {t(locale, 'serviceSessions.findOrCreate')}
      </Button>
      {invalid ? (
        <p id={`${prefix}-error`} role="alert">
          {t(locale, 'serviceSessions.invalidCustomer')}
        </p>
      ) : null}
      {mutation.isError ? <p role="alert">{envelopeMessage(mutation.error, locale)}</p> : null}
      {sessionCustomerCard(value, locale)}
    </fieldset>
  );
}
