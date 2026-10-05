'use client';
import { t } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import { useState } from 'react';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';

// نموذج إصدار كارت: يكتب/يمسح الكود ثم يرسل الإصدار للإدارة.
export function EmployeeCardForm({
  pending,
  error,
  onIssue,
}: {
  pending: boolean;
  error: unknown;
  onIssue: (code: string) => void;
}) {
  const locale = useLocale();
  const [code, setCode] = useState('');
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const value = code.trim();
        if (value.length === 0) return;
        onIssue(value);
        setCode('');
      }}
    >
      <Label htmlFor="employee-card-code">{t(locale, 'employeeCard.issue')}</Label>
      <Input
        id="employee-card-code"
        value={code}
        autoComplete="off"
        onChange={(event) => setCode(event.target.value)}
      />
      <Button type="submit" disabled={pending}>
        {t(locale, 'employeeCard.issueAction')}
      </Button>
      {error ? <p role="alert">{envelopeMessage(error, locale)}</p> : null}
    </form>
  );
}
