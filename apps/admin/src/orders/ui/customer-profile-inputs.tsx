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

type NumericField = { readonly state: 'empty' } | { readonly state: 'invalid' } | { readonly state: 'value'; readonly value: number };

// فاضي معناه مفيش قيمة، وغير صالح معناه إن المستخدم كتب حاجة لازم ترفضها بدل ما تضيع صامتة.
function numericField(value: unknown): NumericField {
  if (value === '' || value === null || value === undefined) return { state: 'empty' };
  // لوحة المفاتيح العربية بتكتب أرقام عربية-هندية؛ نوحّدها قبل الفحص عشان ما نرفضش تاريخ صحيح.
  const text = String(value)
    .trim()
    .replace(/[\u0660-\u0669\u06f0-\u06f9]/g, (digit) => {
      const point = digit.codePointAt(0) ?? 0;
      return String(point - (point <= 0x0669 ? 0x0660 : 0x06f0));
    });
  if (!/^\d+$/.test(text)) return { state: 'invalid' };
  const parsed = Number(text);
  return Number.isInteger(parsed) ? { state: 'value', value: parsed } : { state: 'invalid' };
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
type BirthdayValue = NonNullable<SessionCustomerFormValues['birthday']>;

function resolveBirthday(raw: unknown): { value?: BirthdayValue; invalid: boolean } {
  const birthday =
    raw && typeof raw === 'object'
      ? (raw as { day?: unknown; month?: unknown; year?: unknown })
      : undefined;
  const fields = [
    numericField(birthday?.day),
    numericField(birthday?.month),
    numericField(birthday?.year),
  ] as const;
  if (fields.some((field) => field.state === 'invalid')) return { invalid: true };
  const numbers = fields.map((field) => (field.state === 'value' ? field.value : undefined));
  const [day, month, year] = numbers as [number | undefined, number | undefined, number | undefined];
  if (day === undefined && month === undefined && year === undefined) return { invalid: false };
  if (
    day === undefined ||
    month === undefined ||
    !shape.birthday.safeParse({ day, month, ...(year === undefined ? {} : { year }) }).success ||
    !isCalendarBirthday({ day, month, year })
  )
    return { invalid: true };
  return { value: { day, month, ...(year === undefined ? {} : { year }) }, invalid: false };
}

export const sessionCustomerResolver: Resolver<SessionCustomerFormValues> = async (values) => {
  const errors: FieldErrors<SessionCustomerFormValues> = {};
  if (!shape.name.safeParse(values.name).success) errors.name = { ...issue };
  if (!shape.phone.safeParse(values.phone).success)
    errors.phone = { calling_code: { ...issue }, national_number: { ...issue } };
  if (!shape.locale.safeParse(values.locale).success) errors.locale = { ...issue };

  const gender = omitted(values.gender) ? undefined : values.gender;
  if (gender !== undefined && !shape.gender.safeParse(gender).success) errors.gender = { ...issue };

  const birthdayResult = resolveBirthday((values as Record<string, unknown>)['birthday']);
  if (birthdayResult.invalid)
    errors.birthday = { day: { ...issue }, month: { ...issue }, year: { ...issue } };
  const parsedBirthday = birthdayResult.value;

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
  describedBy: string | undefined;
  invalidate: () => void;
};

type Registration = ReturnType<UseFormReturn<SessionCustomerFormValues>['register']>;

function changed(
  registration: Registration,
  invalidate: () => void,
  revalidate?: () => void,
): Registration {
  return {
    ...registration,
    onChange: (...args: Parameters<Registration['onChange']>) => {
      const submitted = registration.onChange(...args);
      invalidate();
      if (revalidate !== undefined) void Promise.resolve(submitted).then(revalidate);
      return submitted;
    },
  };
}

type FieldProps = {
  id: string;
  locale: Locale;
  describedBy: string | undefined;
};

function GenderChoice({
  id,
  locale,
  describedBy,
  registration,
  invalid,
}: FieldProps & { registration: Registration; invalid: boolean }) {
  return (
    <>
      <div role="radiogroup" aria-label={t(locale, 'serviceSessions.gender')} className="flex flex-wrap gap-4">
        {(['female', 'male'] as const).map((value) => (
          <span key={value} className="flex items-center gap-1">
            <input
              type="radio"
              id={`${id}-gender-${value}`}
              value={value}
              aria-invalid={invalid}
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
  invalid,
  day,
  month,
  year,
}: FieldProps & { day: Registration; month: Registration; year: Registration; invalid: boolean }) {
  return (
    <>
      <Label htmlFor={`${id}-day`}>{t(locale, 'serviceSessions.birthday')}</Label>
      <div className="flex gap-2">
        <Input id={`${id}-day`} inputMode="numeric" autoComplete="off" aria-label={t(locale, 'serviceSessions.birthdayDay')} aria-invalid={invalid} aria-describedby={describedBy} {...day} />
        <Input id={`${id}-month`} inputMode="numeric" autoComplete="off" aria-label={t(locale, 'serviceSessions.birthdayMonth')} aria-invalid={invalid} aria-describedby={describedBy} {...month} />
        <Input id={`${id}-year`} inputMode="numeric" autoComplete="off" aria-label={t(locale, 'serviceSessions.birthdayYear')} aria-invalid={invalid} aria-describedby={describedBy} {...year} />
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
  describedBy,
  invalidate,
}: CustomerProfileInputsProps) {
  const generated = useId();
  const id = `${prefix}-${generated}`;
  // خطأ التقويم بيشمل المجموعة؛ تصحيح خانة واحدة لازم يمسح أخطاء باقي الخانات فوراً.
  const revalidateBirthday = () => {
    void form.trigger(['birthday.day', 'birthday.month', 'birthday.year']);
  };
  return (
    <>
      <GenderChoice id={id} locale={locale} describedBy={describedBy} registration={changed(form.register('gender'), invalidate)} invalid={!!form.formState.errors.gender} />
      <BirthdayFields
        id={id}
        locale={locale}
        describedBy={describedBy}
        invalid={!!form.formState.errors.birthday}
        day={changed(form.register('birthday.day'), invalidate, revalidateBirthday)}
        month={changed(form.register('birthday.month'), invalidate, revalidateBirthday)}
        year={changed(form.register('birthday.year'), invalidate, revalidateBirthday)}
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
