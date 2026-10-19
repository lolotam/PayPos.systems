'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { setEmployeeNumberStartInput, type SetEmployeeNumberStartInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import { useForm } from 'react-hook-form';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useSetEmployeeNumberStart } from '../api/use-employee-numbering';
import { employeeNumberFieldOptions } from '../model/employee-number-form-schema';
import { employeeNumberSaveAlert } from '../model/employee-number-save-alert';
import { ModalDialog } from '@/shared/ui/modal-dialog';

type StartFormProps = {
  companyId: string;
  userId: string;
  nextNumber: number | null;
  readOnly: boolean;
  onClose: () => void;
};

export function EmployeeNumberStartForm(props: StartFormProps) {
  const locale = useLocale();
  const save = useSetEmployeeNumberStart(props.companyId, props.userId);
  const form = useForm<SetEmployeeNumberStartInput>({
    resolver: zodResolver(setEmployeeNumberStartInput),
  });
  const alert = employeeNumberSaveAlert(
    form.formState.errors.start_number,
    save.isError ? save.error : null,
    t(locale, 'staff.numberInvalid'),
    save.isError ? envelopeMessage(save.error, locale) : '',
  );
  const nextNumber = props.nextNumber == null ? '' : String(props.nextNumber);
  return (
    <ModalDialog
      title={t(locale, 'staff.startNumbering')}
      pending={save.isPending}
      onClose={props.onClose}
      className="max-w-lg"
    >
      <form
        onSubmit={form.handleSubmit((body) => {
          if (!props.readOnly) save.mutate(body.start_number, { onSuccess: props.onClose });
        })}
        className="flex flex-col gap-3"
      >
        <p>{t(locale, 'staff.startNumberingLead')}</p>
        <p>
          {t(locale, 'staff.nextNumber')} <span dir="ltr">{nextNumber}</span>
        </p>
        <Label htmlFor="employee-number-start">{t(locale, 'staff.startNumberField')}</Label>
        <Input
          id="employee-number-start"
          dir="ltr"
          inputMode="numeric"
          {...form.register('start_number', employeeNumberFieldOptions)}
          disabled={props.readOnly}
        />
        {alert ? <p role="alert">{alert}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={save.isPending || props.readOnly}>
            {t(locale, 'staff.saveStartNumber')}
          </Button>
          <Button type="button" variant="outline" disabled={save.isPending} onClick={props.onClose}>
            {t(locale, 'staff.closeNumber')}
          </Button>
        </div>
      </form>
    </ModalDialog>
  );
}
