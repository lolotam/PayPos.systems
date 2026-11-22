'use client';
import type { Customer } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, Card, Input, Label } from '@pospay/ui';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import {
  useSessionCustomer,
  type SessionCustomerEntryScope,
  type SessionCustomerFormValues,
} from '../api/use-session-customer';
import type { SessionCustomerProfileEntry } from '../api/use-session-customer-profile';
import { CustomerPackagesLink } from './customer-packages-link';
import { CustomerProfileInputs, sessionCustomerResolver } from './customer-profile-inputs';
import { SessionCustomerProfileCard } from './session-customer-profile-card';

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
  onReset: () => void;
};
type SessionCustomerResolutionOptions = {
  form: SessionCustomerForm;
  mutation: SessionCustomerMutation;
  locale: SessionCustomerLocale;
  publish: PublishSessionCustomer;
  onGenderNeeded: () => void;
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
  // كل حقل مسجّل له قيمة صريحة عشان reset يمسح اللي قبلها من DOM بدل ما يسيبه ظاهر.
  return {
    name,
    phone: { calling_code: '', national_number: '' },
    locale,
    gender: undefined,
    birthday: undefined,
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
  onReset,
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
    onReset();
  }, [scope, locale, onChange, onReset, resetEntry, resetMutation]);
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
  onGenderNeeded,
}: SessionCustomerResolutionOptions) {
  return () => {
    const captured = mutation.captureScope();
    void form.handleSubmit(
      async (input) => {
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
  onGenderNeeded,
  onReset,
}: SessionCustomerEntryOptions & { onGenderNeeded: () => void; onReset: () => void }) {
  const mutation = useSessionCustomer(companyId, branchId, userId, entryScope, businessId);
  const form = useForm<SessionCustomerFormValues>({
    resolver: sessionCustomerResolver,
    defaultValues: customerEntry(value?.name ?? '', locale),
  });
  const scope = JSON.stringify([companyId, branchId, userId, businessId, entryScope]);
  const publish = useSessionCustomerSynchronization({
    form,
    mutation,
    scope,
    locale,
    value,
    onChange,
    onReset,
  });
  const resolve = useSessionCustomerResolution({ form, mutation, locale, publish, onGenderNeeded });
  const invalidate = () => {
    publish(null);
    mutation.reset();
    onReset();
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

type SelectedCardProps = {
  value: SessionCustomerSelection;
  locale: SessionCustomerLocale;
  packages: PackagesLinkScope | null;
  profile: Omit<SessionCustomerProfileEntry, 'customerId'>;
};

function SelectedCustomerCard({ value, locale, packages, profile }: SelectedCardProps) {
  return (
    <Card role="status" className="p-3">
      <p>{t(locale, 'serviceSessions.selected')}</p>
      <p>{value.name}</p>
      <bdi>{value.phone}</bdi>
      <SessionCustomerProfileCard customerId={value.id} locale={locale} {...profile} />
      {/* رابط باقات العميلة يظهر بس لما النموذج يمرر نطاق النشاط والفرع، ويفتح في تبويب جديد
          مع تلميحات النطاق (ids بس) عشان الراووت يتحقق منها ضد خيارات الجلسة. */}
      {packages !== null ? (
        <CustomerPackagesLink
          customerId={value.id}
          newTab
          hints={{
            companyId: packages.companyId,
            businessId: packages.businessId,
            branchId: packages.branchId,
          }}
        />
      ) : null}
    </Card>
  );
}

function SessionCustomerFeedback({
  prefix,
  locale,
  invalid,
  profileInvalid,
  genderHint,
  hasValue,
  mutation,
}: {
  prefix: string;
  locale: SessionCustomerLocale;
  invalid: boolean;
  profileInvalid: boolean;
  genderHint: boolean;
  hasValue: boolean;
  mutation: SessionCustomerMutation;
}) {
  return (
    <>
      {invalid || profileInvalid ? (
        <p id={`${prefix}-error`} role="alert">
          {t(locale, invalid ? 'serviceSessions.invalidCustomer' : 'serviceSessions.invalidProfileFields')}
        </p>
      ) : null}
      {genderHint && !hasValue ? (
        <p role="status">{t(locale, 'serviceSessions.genderNeededHint')}</p>
      ) : null}
      {mutation.isError ? <p role="alert">{envelopeMessage(mutation.error, locale)}</p> : null}
    </>
  );
}

function useSessionCustomerFieldState(props: SessionCustomerFieldProps) {
  const { companyId, branchId, userId, businessId, entryScope = 'branch', value, onChange } = props;
  const locale = useLocale();
  const prefix = useId();
  const [genderHint, setGenderHint] = useState(false);
  const entry = useSessionCustomerEntry({
    companyId,
    branchId,
    userId,
    ...(businessId === undefined ? {} : { businessId }),
    entryScope,
    value,
    onChange,
    locale,
    onGenderNeeded: () => setGenderHint(true),
    onReset: () => setGenderHint(false),
  });
  return { locale, prefix, genderHint, ...entry };
}

export function SessionCustomerField(props: SessionCustomerFieldProps) {
  const { companyId, branchId, userId, businessId, onBlur, disabled = false, packagesScope = null, value, entryScope = 'branch' } = props;
  const { locale, prefix, genderHint, form, mutation, invalid, nameEntry, callingCode, nationalNumber, resolve, invalidate } =
    useSessionCustomerFieldState(props);
  return (
    <>
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
      <CustomerProfileInputs
        prefix={prefix}
        locale={locale}
        form={form}
        entryScope={entryScope}
        describedBy={invalid ? `${prefix}-error` : undefined}
        invalidate={invalidate}
      />
      <Button type="button" disabled={!!value} onClick={() => void resolve()}>
        {t(locale, 'serviceSessions.findOrCreate')}
      </Button>
      <SessionCustomerFeedback
        prefix={prefix}
        locale={locale}
        invalid={invalid}
        profileInvalid={
          !!form.formState.errors.gender ||
          !!form.formState.errors.birthday ||
          !!form.formState.errors.email ||
          !!form.formState.errors.note
        }
        genderHint={genderHint}
        hasValue={value !== null}
        mutation={mutation}
      />
      </fieldset>
      {/* البطاقة للقراءة فقط؛ برّه fieldset التعريف عشان زر إعادة التحميل يشتغل بعد قفل الزيارة. */}
      {value === null ? null : (
        <SelectedCustomerCard
          value={value}
          locale={locale}
          packages={packagesScope}
          profile={{ companyId, branchId, businessId, userId, entryScope }}
        />
      )}
    </>
  );
}
