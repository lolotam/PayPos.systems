'use client';
import { t, type Locale } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import { useState } from 'react';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';

function issueErrorMessage(error: unknown, locale: Locale): string {
  if (typeof error === 'object' && error !== null) {
    const body = error as { status?: unknown; code?: unknown; retryAfter?: unknown };
    const limited = body.status === 429 || body.code === 'TOO_MANY_REQUESTS';
    if (
      limited &&
      typeof body.retryAfter === 'number' &&
      Number.isInteger(body.retryAfter) &&
      body.retryAfter > 0
    ) {
      const seconds = new Intl.NumberFormat(locale, { numberingSystem: 'latn' }).format(
        body.retryAfter,
      );
      return t(locale, 'employeeCard.issueLimitedFor').replace('{seconds}', seconds);
    }
  }
  return envelopeMessage(error, locale);
}

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
        type="text"
        className="card-code-mask"
        spellCheck={false}
        autoCapitalize="off"
        value={code}
        autoComplete="off"
        onChange={(event) => setCode(event.target.value)}
      />
      <Button type="submit" disabled={pending}>
        {t(locale, 'employeeCard.issueAction')}
      </Button>
      {error ? <p role="alert">{issueErrorMessage(error, locale)}</p> : null}
    </form>
  );
}
