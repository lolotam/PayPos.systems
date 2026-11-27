'use client';

import { t, type MessageKey } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';

/** خيار واحد في قائمة الاختيار: القيمة اللي بتتبعت والاسم اللي بيتعرض. */
export interface SelectChoice {
  readonly value: string;
  readonly label: string;
}

/** حقل اختيار بعنوان: نفس شكل حقول الدعوة، والقيمة بتتبعت كـ string. */
export function InvitationSelectField({
  id,
  label,
  value,
  choices,
  placeholder,
  onChange,
}: {
  id: string;
  label: MessageKey;
  value: string;
  choices: readonly SelectChoice[];
  placeholder?: MessageKey;
  onChange: (value: string) => void;
}) {
  const locale = useLocale();
  return (
    <label className="flex flex-col gap-1" htmlFor={id}>
      <span className="text-sm font-medium">{t(locale, label)}</span>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border bg-background px-3 py-2"
      >
        {placeholder === undefined ? null : (
          <option value="" disabled>
            {t(locale, placeholder)}
          </option>
        )}
        {choices.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** حقل نص بعنوان: اسم واحد وزر لازم يبقى مقروء. */
export function InvitationTextField({
  id,
  label,
  value,
  maxLength,
  inputType,
  onChange,
}: {
  id: string;
  label: MessageKey;
  value: string;
  maxLength?: number;
  inputType?: 'text' | 'datetime-local';
  onChange: (value: string) => void;
}) {
  const locale = useLocale();
  return (
    <label className="flex flex-col gap-1" htmlFor={id}>
      <span className="text-sm font-medium">{t(locale, label)}</span>
      <input
        id={id}
        type={inputType ?? 'text'}
        value={value}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border bg-background px-3 py-2"
      />
    </label>
  );
}
