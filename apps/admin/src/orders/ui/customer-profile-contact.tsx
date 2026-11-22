'use client';
import { t } from '@pospay/i18n';
import { Input, Label } from '@pospay/ui';
import type { ClipboardEvent } from 'react';

import type { FieldProps, Registration } from './customer-profile-controls';

export function ContactFields({
  id,
  locale,
  describedBy,
  email,
  note,
  emailInvalid,
  noteInvalid,
  scoped,
  setEmailValue,
}: FieldProps & {
  email: Registration;
  note: Registration;
  emailInvalid: boolean;
  noteInvalid: boolean;
  scoped: boolean;
  setEmailValue: (value: string) => void;
}) {
  // المتصفح يقص CR/LF من لصق البريد؛ نوقف اللصق ونحط القيمة الخام كاملة في النموذج،
  // والعقد هو اللي يقرر صحتها — مفيش نسخة تانية من قواعد البريد هنا.
  const onEmailPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const raw = event.clipboardData.getData('text');
    if (!/[\r\n]/.test(raw)) return;
    event.preventDefault();
    const input = event.currentTarget;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    setEmailValue(input.value.slice(0, start) + raw + input.value.slice(end));
  };
  return (
    <>
      <Label htmlFor={`${id}-email`}>{t(locale, 'serviceSessions.email')}</Label>
      <Input id={`${id}-email`} type="text" inputMode="email" autoComplete="off" dir="ltr" aria-invalid={emailInvalid} aria-describedby={describedBy} {...email} onPaste={onEmailPaste} />
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
