'use client';
import { t } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import type { ClipboardEvent } from 'react';

import type { FieldProps, Registration } from './customer-profile-controls';

export function ContactFields({
  id,
  locale,
  describedBy,
  email,
  note,
  emailInvalid,
  emailRejected,
  noteInvalid,
  scoped,
  onRejectedPaste,
  onOmitEmail,
}: FieldProps & {
  email: Registration;
  note: Registration;
  emailInvalid: boolean;
  emailRejected: boolean;
  noteInvalid: boolean;
  scoped: boolean;
  onRejectedPaste: () => void;
  onOmitEmail: () => void;
}) {
  // المتصفح يقص CR/LF من لصق البريد؛ نرفض اللصق ونمسك الرفض عند بوابة الإرسال،
  // عشان الـ blur ما يرجّعش قيمة صالحة بعد ما المتصفح عدّل الخام.
  const onEmailPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    if (!/[\r\n]/.test(event.clipboardData.getData('text'))) return;
    event.preventDefault();
    onRejectedPaste();
  };
  return (
    <>
      <Label htmlFor={`${id}-email`}>{t(locale, 'serviceSessions.email')}</Label>
      <Input id={`${id}-email`} type="text" inputMode="email" autoComplete="off" dir="ltr" aria-invalid={emailInvalid} aria-describedby={describedBy} {...email} onPaste={onEmailPaste} />
      {emailRejected ? (
        <Button type="button" variant="outline" onClick={onOmitEmail}>
          {t(locale, 'serviceSessions.emailOmit')}
        </Button>
      ) : null}
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
