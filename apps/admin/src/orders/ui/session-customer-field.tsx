'use client';
import type { Customer } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { useBrowserConnectivity } from '../model/use-browser-connectivity';
import {
  useSessionCustomer,
  type SessionCustomerEntryScope,
  type SessionCustomerFormValues,
} from '../api/use-session-customer';
import { CustomerProfileInputs, sessionCustomerResolver } from './customer-profile-inputs';
import { SelectedCustomerCard } from './selected-customer-card';
import { SessionCustomerProfileCard } from './session-customer-profile-card';
import { SessionCustomerFeedback } from './session-customer-feedback';

export type SessionCustomerSelection = Pick<Customer, 'id' | 'name' | 'phone'>;

/** نطاق النشاط والفرع والمستخدم اللي يفعّل رابط باقات العميلة في كارت الزبونة المختارة (42-4). */
type PackagesLinkScope = { companyId: string; businessId: string; branchId: string; userId: string };

type SessionCustomerFieldProps = {
  companyId: string;
  branchId: string;
  userId: string;
  businessId?: string;
  entryScope?: SessionCustomerEntryScope;
  value: SessionCustomerSelection | null;
  onChange: (value: SessionCustomerSelection | null) => void;
  onBlur?: () => void;
  disabled?: boolean;
  packagesScope?: PackagesLinkScope | null;
  /** معرّف زبونة مستعاد من زيارة محفوظة؛ البطاقة تُقرأ به حتى لو ملخص الزبونة مش موجود. */
  profileCustomerId?: string | null;
  onAccessDenied?: () => void;
};
type SessionCustomerLocale = SessionCustomerFormValues['locale'];
type SessionCustomerForm = UseFormReturn<SessionCustomerFormValues>;
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
  onFullReset: () => void;
  onScopeReset: () => void;
  recoveryId: string | null;
};
type SessionCustomerResolutionOptions = {
  form: SessionCustomerForm;
  mutation: SessionCustomerMutation;
  locale: SessionCustomerLocale;
  publish: PublishSessionCustomer;
  onGenderNeeded: () => void;
  emailRejected: boolean;
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

function customerEntry(name: string, locale: SessionCustomerLocale): SessionCustomerFormValues {
  // undefined بيخلي RHF يقرأ قيمة قديمة من DOM وقت إعادة التسجيل؛ null بيمسح الحقول فعلياً.
  return {
    name,
    phone: { calling_code: '', national_number: '' },
    locale,
    gender: null as unknown as SessionCustomerFormValues['gender'],
    birthday: { day: '', month: '', year: '' } as unknown as SessionCustomerFormValues['birthday'],
    email: '',
    note: '',
  };
}

function useSessionCustomerSynchronization({
  form,
  mutation,
  scope,
  locale,
  value,
  onChange,
  onFullReset,
  onScopeReset,
  recoveryId,
}: SessionCustomerSynchronizationOptions): PublishSessionCustomer {
  const previousScope = useRef(scope);
  const previousRecovery = useRef(recoveryId);
  const { reset: resetEntry } = form;
  const { reset: resetMutation } = mutation;
  useLayoutEffect(() => {
    if (previousScope.current === scope) return;
    previousScope.current = scope;
    onChange(null);
    resetEntry(customerEntry('', locale));
    resetMutation();
    onFullReset();
    onScopeReset();
  }, [scope, locale, onChange, onFullReset, onScopeReset, resetEntry, resetMutation]);
  // استعادة زيارة بمعرّف بس لازم تمسح مسودة قديمة كانت هتخفي بطاقة الزبونة المستعادة.
  useLayoutEffect(() => {
    if (previousRecovery.current === recoveryId) return;
    previousRecovery.current = recoveryId;
    if (recoveryId !== null) {
      resetEntry(customerEntry('', locale));
      resetMutation();
      onFullReset();
    }
  }, [recoveryId, locale, onFullReset, resetEntry, resetMutation]);
  const observed = useRef(value),
    emitted = useRef<SessionCustomerSelection | null | undefined>(undefined);
  useLayoutEffect(() => {
    if (observed.current === value) return;
    observed.current = value;
    if (emitted.current !== value) {
      resetEntry(customerEntry(value?.name ?? '', locale));
      resetMutation();
      onFullReset();
    }
    emitted.current = undefined;
  }, [value, locale, onFullReset, resetEntry, resetMutation]);
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
  onGenderNeeded,
  emailRejected,
}: SessionCustomerResolutionOptions) {
  return () => {
    const captured = mutation.captureScope();
    void form.handleSubmit(
      async (input) => {
        // رفض اللصق الخام يفضل ملزم لحد تعديل حقيقي للبريد، حتى لو الـ blur رجّع قيمة صالحة.
        if (emailRejected) return;
        if (!mutation.isCurrentScope(captured)) return;
        try {
          const saved = await mutation.mutateAsync({ ...input, locale });
          if (!mutation.isCurrentScope(captured)) return;
          publish({ id: saved.id, name: saved.name, phone: saved.phone });
          form.reset(customerEntry(saved.name, locale));
          mutation.reset();
        } catch (error) {
          // رفض متأخر من سياق قديم ما يظهرش تلميحاً للمستخدم الحالي.
          if (!mutation.isCurrentScope(captured)) return;
          // النوع اختياري في العقد عشان البحث؛ الرفض وقت الإنشاء بيجي من الـ domain.
          // من غير ما ندّعي إن كل رفض معناه إن الهاتف جديد، بنرشد لاختيار النوع لو فاضي.
          const gender = form.getValues('gender');
          if (
            (error as { code?: string } | null)?.code === 'VALIDATION_FAILED' &&
            (gender === undefined || gender === null)
          )
            onGenderNeeded();
          return;
        }
      },
      () => {
        if (form.getValues('gender') === undefined || form.getValues('gender') === null)
          onGenderNeeded();
      },
    )();
  };
}

function useSessionCustomerEntry({
  companyId,
  branchId,
  userId,
  businessId,
  entryScope = 'branch',
  value,
  onChange,
  locale,
  profileCustomerId,
  online,
  onGenderNeeded,
  onFieldEdit,
  onFullReset,
  onScopeReset,
  emailRejected,
}: SessionCustomerEntryOptions & {
  profileCustomerId: string | null;
  online: boolean | null;
  onGenderNeeded: () => void;
  onFieldEdit: () => void;
  onFullReset: () => void;
  onScopeReset: () => void;
  emailRejected: boolean;
}) {
  const mutation = useSessionCustomer(companyId, branchId, userId, entryScope, businessId, online);
  const form = useForm<SessionCustomerFormValues>({
    resolver: sessionCustomerResolver,
    defaultValues: customerEntry(value?.name ?? '', locale),
  });
  const scope = JSON.stringify([companyId, branchId, userId, businessId, entryScope]);
  const publish = useSessionCustomerSynchronization({ form, mutation, scope, locale, value, onChange, onFullReset, onScopeReset, recoveryId: value === null ? profileCustomerId : null });
  const resolve = useSessionCustomerResolution({ form, mutation, locale, publish, onGenderNeeded, emailRejected });
  const invalidate = () => {
    publish(null);
    mutation.reset();
    onFieldEdit();
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
  const describedBy = invalid ? `${prefix}-error` : undefined;
  const watched = (entry: SessionCustomerRegistration) => ({
    ...entry,
    onChange: (event: Parameters<SessionCustomerRegistration['onChange']>[0]) => {
      void entry.onChange(event);
      invalidate();
    },
  });
  return (
    <>
      <Label htmlFor={`${prefix}-name`}>{t(locale, 'serviceSessions.name')}</Label>
      <Input id={`${prefix}-name`} autoComplete="off" aria-invalid={!!form.formState.errors.name} aria-describedby={describedBy} {...watched(nameEntry)} />
      <Label htmlFor={`${prefix}-code`}>{t(locale, 'serviceSessions.callingCode')}</Label>
      <Input id={`${prefix}-code`} dir="ltr" inputMode="numeric" autoComplete="off" aria-invalid={!!form.formState.errors.phone?.calling_code} aria-describedby={describedBy} {...watched(callingCode)} />
      <Label htmlFor={`${prefix}-phone`}>{t(locale, 'serviceSessions.phone')}</Label>
      <Input id={`${prefix}-phone`} dir="ltr" type="tel" autoComplete="off" aria-invalid={!!form.formState.errors.phone?.national_number} aria-describedby={describedBy} {...watched(nationalNumber)} />
    </>
  );
}

function useSessionCustomerFieldState(props: SessionCustomerFieldProps) {
  const { companyId, branchId, userId, businessId, entryScope = 'branch', value, onChange, profileCustomerId = null } = props;
  const locale = useLocale();
  const prefix = useId();
  const browserOnline = useBrowserConnectivity();
  const [genderHint, setGenderHint] = useState(false);
  const [emailRejected, setEmailRejected] = useState(false);
  const [suppressedRecovery, setSuppressedRecovery] = useState<string | null>(null);
  const [previousRecoveryProp, setPreviousRecoveryProp] = useState(profileCustomerId);
  if (previousRecoveryProp !== profileCustomerId) {
    setPreviousRecoveryProp(profileCustomerId);
    setSuppressedRecovery(null);
  }
  const recoveryId = suppressedRecovery === profileCustomerId ? null : profileCustomerId;
  const entry = useSessionCustomerEntry({
    companyId,
    branchId,
    userId,
    ...(businessId === undefined ? {} : { businessId }),
    entryScope,
    value,
    onChange,
    locale,
    profileCustomerId: recoveryId,
    online: browserOnline,
    onGenderNeeded: () => setGenderHint(true),
    onFieldEdit: () => setGenderHint(false),
    onFullReset: () => { setGenderHint(false); setEmailRejected(false); },
    onScopeReset: () => setSuppressedRecovery(profileCustomerId),
    emailRejected,
  });
  return { locale, prefix, genderHint, recoveryId, online: browserOnline, emailRejected, setEmailRejected, ...entry };
}

export function SessionCustomerField(props: SessionCustomerFieldProps) {
  const { companyId, branchId, userId, businessId, onBlur, disabled = false, packagesScope = null, value, entryScope = 'branch', onAccessDenied } = props;
  const { locale, prefix, genderHint, recoveryId, online, emailRejected, setEmailRejected, form, mutation, nameEntry, callingCode, nationalNumber, resolve, invalidate } =
    useSessionCustomerFieldState(props);
  const profileInvalid = emailRejected || !!form.formState.errors.gender || !!form.formState.errors.birthday || !!form.formState.errors.email || !!form.formState.errors.note;
  const contactInvalid = !!form.formState.errors.name || !!form.formState.errors.phone || !!form.formState.errors.locale;
  return (
    <>
      <fieldset disabled={disabled || mutation.isPending || form.formState.isSubmitting} onBlur={onBlur} className="flex flex-col gap-3 text-start">
      <legend>{t(locale, 'serviceSessions.customer')}</legend>
      {sessionCustomerContact({ prefix, locale, form, invalid: contactInvalid, nameEntry, callingCode, nationalNumber, invalidate })}
      <CustomerProfileInputs prefix={prefix} locale={locale} form={form} entryScope={entryScope} describedBy={profileInvalid ? `${prefix}-profile-error` : undefined} emailRejected={emailRejected} invalidate={invalidate} onEmailRejected={() => setEmailRejected(true)} onEmailEdit={() => setEmailRejected(false)} />
      <Button type="button" disabled={!!value || online !== true} onClick={() => { if (online === true) void resolve(); }}>
        {t(locale, 'serviceSessions.findOrCreate')}
      </Button>
      <SessionCustomerFeedback
        prefix={prefix}
        locale={locale}
        contactInvalid={contactInvalid}
        profileInvalid={profileInvalid}
        genderHint={genderHint}
        hasValue={value !== null}
        mutation={mutation}
      />
      </fieldset>
      {value === null ? null : (
        <SelectedCustomerCard
          value={value}
          locale={locale}
          packages={packagesScope}
          profile={{ companyId, branchId, businessId, userId, entryScope }}
          online={online}
          onAccessDenied={onAccessDenied}
        />
      )}
      {value !== null || recoveryId === null || form.formState.isDirty ? null : (
        <SessionCustomerProfileCard customerId={recoveryId} locale={locale} online={online} companyId={companyId} branchId={branchId} businessId={businessId} userId={userId} entryScope={entryScope} onAccessDenied={onAccessDenied} />
      )}
    </>
  );
}
