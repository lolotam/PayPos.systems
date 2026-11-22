'use client';
import { findOrCreateScopedCustomerInput } from '@pospay/contracts';
import { isValidCustomerBirthdayCalendar } from '@pospay/domain';
import { type Locale } from '@pospay/i18n';
import { useId } from 'react';
import type { FieldErrors, Resolver, UseFormReturn } from 'react-hook-form';

import type {
  SessionCustomerEntryScope,
  SessionCustomerFormValues,
} from '../api/use-session-customer';
import { changed } from './customer-profile-controls';
import { BirthdayFields } from './customer-profile-birthday';
import { ContactFields } from './customer-profile-contact';
import { GenderChoice } from './customer-profile-gender';

const shape = findOrCreateScopedCustomerInput.shape;

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

const issue = { type: 'invalid', message: 'invalid' } as const;

// RHF بيعطي null للراديو غير المختار و'' للحقول النصية الفاضية؛ الاتنين معناهم «مفيش قيمة».
function omitted(value: unknown): boolean {
  return value === null || value === '' || value === undefined;
}

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
    !isValidCustomerBirthdayCalendar({ day, month, year })
  )
    return { invalid: true };
  return { value: { day, month, ...(year === undefined ? {} : { year }) }, invalid: false };
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
  emailRejected: boolean;
  onEmailRejected: () => void;
  onEmailEdit: () => void;
  onOmitEmail: () => void;
};

export function CustomerProfileInputs({
  prefix,
  locale,
  form,
  entryScope,
  describedBy,
  invalidate,
  emailRejected,
  onEmailRejected,
  onEmailEdit,
  onOmitEmail,
}: CustomerProfileInputsProps) {
  const generated = useId();
  const id = `${prefix}-${generated}`;
  // خطأ التقويم بيشمل المجموعة؛ بعد أول محاولة، تصحيح خانة يمسح أخطاء باقي الخانات.
  const revalidateBirthday = () => {
    if (!form.formState.isSubmitted) return;
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
        email={changed(form.register('email'), () => { invalidate(); onEmailEdit(); })}
        note={changed(form.register('note'), invalidate)}
        emailInvalid={emailRejected || !!form.formState.errors.email}
        emailRejected={emailRejected}
        noteInvalid={!!form.formState.errors.note}
        scoped={entryScope !== 'company'}
        onRejectedPaste={onEmailRejected}
        onOmitEmail={onOmitEmail}
      />
    </>
  );
}
