'use client';
import { parseEmployeeNumber } from '@pospay/domain';
import { t } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useLocale } from '@/shared/locale/locale-context';

function submitNumber(
  event: FormEvent<HTMLFormElement>,
  text: string,
  onSubmit: (employeeNumber: number) => void,
  setInvalid: (invalid: boolean) => void,
) {
  event.preventDefault();
  // parseEmployeeNumber يرفض المسافة؛ القص هنا عشان « 007 » يبقى 7 قبل الإرسال (EN-Q8).
  const parsed = parseEmployeeNumber(text.trim());
  if (parsed === null) {
    setInvalid(true);
    return;
  }
  setInvalid(false);
  onSubmit(parsed);
}

function closeOnEscape(pending: boolean, onClose: () => void, event: KeyboardEvent<HTMLFormElement>) {
  if (event.key !== 'Escape' || pending) return;
  event.preventDefault();
  onClose();
}

export function CompanyEmployeeNumberEditor({
  current,
  pending,
  message,
  onSubmit,
  onClose,
}: {
  current: number | null;
  pending: boolean;
  message: string | null;
  onSubmit: (employeeNumber: number) => void;
  onClose: () => void;
}) {
  const locale = useLocale();
  const fieldId = useId();
  const field = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(current === null ? '' : String(current));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    field.current?.focus();
  }, []);
  return (
    <form
      onSubmit={(event) => submitNumber(event, text, onSubmit, setInvalid)}
      onKeyDown={(event) => closeOnEscape(pending, onClose, event)}
      className="flex max-w-xs flex-col gap-2"
    >
      <Label htmlFor={fieldId}>{t(locale, 'companyEmployeeNumbers.number')}</Label>
      <Input
        ref={field}
        id={fieldId}
        inputMode="numeric"
        autoComplete="off"
        value={text}
        disabled={pending}
        aria-invalid={invalid}
        onChange={(event) => {
          setText(event.target.value);
          setInvalid(false);
        }}
      />
      {invalid ? <p role="alert">{t(locale, 'companyEmployeeNumbers.invalid')}</p> : null}
      {message ? <p role="alert">{message}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {t(locale, 'companyEmployeeNumbers.save')}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={onClose}>
          {t(locale, 'companyEmployeeNumbers.close')}
        </Button>
      </div>
    </form>
  );
}
