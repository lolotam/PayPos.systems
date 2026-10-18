'use client';
import { t } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import { useEffect, useState, type FormEvent } from 'react';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useSetEmployeeNumber } from '../api/use-set-employee-number';
import { displayEmployeeNumber } from '../model/employee-number-display';
import { typedEmployeeNumber } from '../model/typed-employee-number';

type EditFormProps = {
  companyId: string;
  businessId: string;
  userId: string;
  employeeId: string;
  employeeNumber: number | null;
  onClose: () => void;
};

function submitDraft(
  event: FormEvent<HTMLFormElement>,
  draft: string,
  save: (value: number) => void,
  setInvalid: (value: boolean) => void,
) {
  event.preventDefault();
  const parsed = typedEmployeeNumber(draft);
  if (parsed === undefined || parsed === null) {
    setInvalid(true);
    return;
  }
  setInvalid(false);
  save(parsed);
}

export function EmployeeNumberEditForm(props: EditFormProps) {
  const locale = useLocale();
  const save = useSetEmployeeNumber(props.companyId, props.businessId, props.userId, props.employeeId);
  const { onClose } = props;
  const [draft, setDraft] = useState('');
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    if (save.isSuccess) onClose();
  }, [onClose, save.isSuccess]);
  const alert = invalid
    ? t(locale, 'staff.numberInvalid')
    : save.isError
      ? envelopeMessage(save.error, locale)
      : null;
  return (
    <dialog open aria-labelledby="employee-number-edit-title" className="w-full max-w-lg rounded-xl border border-border bg-card p-6 text-start text-card-foreground">
      <form
        onSubmit={(event) => submitDraft(event, draft, save.mutate, setInvalid)}
        className="flex flex-col gap-3"
      >
        <h3 id="employee-number-edit-title" className="text-lg font-bold">{t(locale, 'staff.editNumberTitle')}</h3>
        <p>
          <span className="sr-only">{t(locale, 'staff.currentNumber')} </span>
          <span dir="ltr">{displayEmployeeNumber(props.employeeNumber)}</span>
        </p>
        <Label htmlFor="employee-number-edit">{t(locale, 'staff.employeeNumber')}</Label>
        <Input id="employee-number-edit" dir="ltr" inputMode="numeric" value={draft} onChange={(event) => setDraft(event.target.value)} />
        {alert ? <p role="alert">{alert}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={save.isPending}>{t(locale, 'staff.saveNumber')}</Button>
          <Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>{t(locale, 'staff.closeNumber')}</Button>
        </div>
      </form>
    </dialog>
  );
}
