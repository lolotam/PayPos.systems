'use client';
import { findOrCreateScopedCustomerInput } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { Input, Label } from '@pospay/ui';
import { useId } from 'react';
import type { FieldErrors, Resolver, UseFormReturn } from 'react-hook-form';

import type {
  SessionCustomerEntryScope,
  SessionCustomerFormValues,
} from '../api/use-session-customer';

const shape = findOrCreateScopedCustomerInput.shape;

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

function numeric(value: unknown): number | undefined {
  if (value === '' || value === null || value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function isCalendarBirthday(birthday: {
  day: number;
  month: number;
  year?: number | undefined;
}): boolean {
  if (birthday.month < 1 || birthday.month > 12) return false;
  if (birthday.day < 1 || birthday.day > (DAYS_IN_MONTH[birthday.month - 1] ?? 31)) return false;
  if (birthday.year === undefined) return true;
  if (birthday.year < 1 || birthday.year > 9999) return false;
  const leap = birthday.year % 4 === 0 && (birthday.year % 100 !== 0 || birthday.year % 400 === 0);
  return !(birthday.month === 2 && birthday.day === 29 && !leap);
}

const issue = { type: 'invalid', message: 'invalid' } as const;

// RHF بيعطي null للراديو غير المختار و'' للحقول النصية الفاضية؛ الاتنين معناهم «مفيش قيمة».
function omitted(value: unknown): boolean {
  return value === null || value === '' || value === undefined;
}

/**
 * النموذج بيستخدم عقود @pospay/contracts كما هي: مفيش نسخة تانية من قواعد البريد والملاحظة،
 * واليوم والشهر لازم مع بعض والسنة اختيارية من غير ما نخترع 2000. رسائل الحقول من غير بيانات مدخلة.
 */
export const sessionCustomerResolver: Resolver<SessionCustomerFormValues> = async (values) => {
  const errors: FieldErrors<SessionCustomerFormValues> = {};
  if (!shape.name.safeParse(values.name).success) errors.name = { ...issue };
  if (!shape.phone.safeParse(values.phone).success)
    errors.phone = { calling_code: { ...issue }, national_number: { ...issue } };
  if (!shape.locale.safeParse(values.locale).success) errors.locale = { ...issue };

  const gender = omitted(values.gender) ? undefined : values.gender;
  if (gender !== undefined && !shape.gender.safeParse(gender).success) errors.gender = { ...issue };

  const rawBirthday = (values as Record<string, unknown>)['birthday'];
  const birthday =
    rawBirthday && typeof rawBirthday === 'object'
      ? (rawBirthday as { day?: unknown; month?: unknown; year?: unknown })
      : undefined;
  const day = numeric(birthday?.day);
  const month = numeric(birthday?.month);
  const year = numeric(birthday?.year);
  const hasBirthday = day !== undefined || month !== undefined || year !== undefined;
  let parsedBirthday: SessionCustomerFormValues['birthday'];
  if (hasBirthday) {
    if (
      day === undefined ||
      month === undefined ||
      !shape.birthday.safeParse({ day, month, ...(year === undefined ? {} : { year }) }).success ||
      !isCalendarBirthday({ day, month, year })
    ) {
      errors.birthday = { day: { ...issue }, month: { ...issue } };
    } else {
      parsedBirthday = { day, month, ...(year === undefined ? {} : { year }) };
    }
  }

  const email = omitted(values.email) ? undefined : values.email;
  if (email !== undefined && !shape.email.safeParse(email).success) errors.email = { ...issue };
  const note = omitted(values.note) ? undefined : values.note;
  if (note !== undefined && !shape.note.safeParse(note).success) errors.note = { ...issue };

  if (Object.keys(errors).length > 0)
    return { values: {} as Record<string, never>, errors };
  return {
    values: {
      name: values.name,
      phone: values.phone,
      locale: values.locale,
      ...(gender === undefined ? {} : { gender }),
      ...(parsedBirthday === undefined ? {} : { birthday: parsedBirthday }),
      ...(email === undefined ? {} : { email }),
      ...(note === undefined ? {} : { note }),
    },
    errors: {},
  };
};

type CustomerProfileInputsProps = {
  prefix: string;
  locale: Locale;
  form: UseFormReturn<SessionCustomerFormValues>;
  entryScope: SessionCustomerEntryScope;
  invalid: boolean;
  invalidate: () => void;
};

type Registration = ReturnType<UseFormReturn<SessionCustomerFormValues>['register']>;

function changed(registration: Registration, invalidate: () => void): Registration {
  return {
    ...registration,
    onChange: (...args: Parameters<Registration['onChange']>) => {
      const submitted = registration.onChange(...args);
      invalidate();
      return submitted;
    },
  };
}

type FieldProps = {
  id: string;
  locale: Locale;
  describedBy: string | undefined;
};

function GenderChoice({ id, locale, describedBy, registration }: FieldProps & { registration: Registration }) {
  return (
    <>
      <div role="radiogroup" aria-label={t(locale, 'serviceSessions.gender')} className="flex flex-wrap gap-4">
        {(['female', 'male'] as const).map((value) => (
          <span key={value} className="flex items-center gap-1">
            <input
              type="radio"
              id={`${id}-gender-${value}`}
              value={value}
              aria-describedby={describedBy}
              {...registration}
            />
            <Label htmlFor={`${id}-gender-${value}`}>
              {t(locale, value === 'female' ? 'serviceSessions.genderFemale' : 'serviceSessions.genderMale')}
            </Label>
          </span>
        ))}
      </div>
      <p className="text-xs opacity-80">{t(locale, 'serviceSessions.genderRequiredForNew')}</p>
    </>
  );
}

function BirthdayFields({
  id,
  locale,
  describedBy,
  day,
  month,
  year,
}: FieldProps & { day: Registration; month: Registration; year: Registration }) {
  return (
    <>
      <Label htmlFor={`${id}-day`}>{t(locale, 'serviceSessions.birthday')}</Label>
      <div className="flex gap-2">
        <Input id={`${id}-day`} inputMode="numeric" autoComplete="off" aria-label={t(locale, 'serviceSessions.birthdayDay')} aria-describedby={describedBy} {...day} />
        <Input id={`${id}-month`} inputMode="numeric" autoComplete="off" aria-label={t(locale, 'serviceSessions.birthdayMonth')} aria-describedby={describedBy} {...month} />
        <Input id={`${id}-year`} inputMode="numeric" autoComplete="off" aria-label={t(locale, 'serviceSessions.birthdayYear')} aria-describedby={describedBy} {...year} />
      </div>
    </>
  );
}

function ContactFields({
  id,
  locale,
  describedBy,
  email,
  note,
  emailInvalid,
  noteInvalid,
  scoped,
}: FieldProps & {
  email: Registration;
  note: Registration;
  emailInvalid: boolean;
  noteInvalid: boolean;
  scoped: boolean;
}) {
  return (
    <>
      <Label htmlFor={`${id}-email`}>{t(locale, 'serviceSessions.email')}</Label>
      <Input id={`${id}-email`} type="email" autoComplete="off" dir="ltr" aria-invalid={emailInvalid} aria-describedby={describedBy} {...email} />
      {!scoped ? null : (
        <>
          <Label htmlFor={`${id}-note`}>{t(locale, 'serviceSessions.note')}</Label>
          <textarea id={`${id}-note`} rows={3} aria-invalid={noteInvalid} aria-describedby={describedBy} className="min-h-20 w-full rounded-md border bg-transparent p-2" {...note} />
          <p className="text-xs opacity-80">{t(locale, 'serviceSessions.notePrivacy')}</p>
        </>
      )}
    </>
  );
}

export function CustomerProfileInputs({
  prefix,
  locale,
  form,
  entryScope,
  invalid,
  invalidate,
}: CustomerProfileInputsProps) {
  const generated = useId();
  const id = `${prefix}-${generated}`;
  const describedBy = invalid ? `${id}-error` : undefined;
  return (
    <>
      <GenderChoice id={id} locale={locale} describedBy={describedBy} registration={changed(form.register('gender'), invalidate)} />
      <BirthdayFields
        id={id}
        locale={locale}
        describedBy={describedBy}
        day={changed(form.register('birthday.day'), invalidate)}
        month={changed(form.register('birthday.month'), invalidate)}
        year={changed(form.register('birthday.year'), invalidate)}
      />
      <ContactFields
        id={id}
        locale={locale}
        describedBy={describedBy}
        email={changed(form.register('email'), invalidate)}
        note={changed(form.register('note'), invalidate)}
        emailInvalid={!!form.formState.errors.email}
        noteInvalid={!!form.formState.errors.note}
        scoped={entryScope !== 'company'}
      />
    </>
  );
}
