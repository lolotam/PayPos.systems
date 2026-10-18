'use client';
import { t } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import { useState, type FormEvent } from 'react';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useSetEmployeeNumberStart } from '../api/use-employee-numbering';
import { typedEmployeeNumber } from '../model/typed-employee-number';

export function EmployeeNumberStartForm({
  companyId,
  userId,
  nextNumber,
}: {
  companyId: string;
  userId: string;
  nextNumber: number;
}) {
  const locale = useLocale();
  const save = useSetEmployeeNumberStart(companyId, userId);
  const [draft, setDraft] = useState('');
  const [invalid, setInvalid] = useState(false);
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = typedEmployeeNumber(draft);
    if (parsed === undefined || parsed === null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    save.mutate(parsed);
  };
  const alert = invalid
    ? t(locale, 'staff.numberInvalid')
    : save.isError
      ? envelopeMessage(save.error, locale)
      : null;
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <h2 id="employee-number-start-title" className="text-xl font-bold">
        {t(locale, 'staff.startNumbering')}
      </h2>
      <p>{t(locale, 'staff.startNumberingLead')}</p>
      <p>
        {t(locale, 'staff.nextNumber')} <span dir="ltr">{String(nextNumber)}</span>
      </p>
      <Label htmlFor="employee-number-start">{t(locale, 'staff.startNumberField')}</Label>
      <Input
        id="employee-number-start"
        dir="ltr"
        inputMode="numeric"
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          setInvalid(false);
        }}
      />
      {alert ? <p role="alert">{alert}</p> : null}
      <Button type="submit" disabled={save.isPending}>
        {t(locale, 'staff.saveStartNumber')}
      </Button>
    </form>
  );
}
