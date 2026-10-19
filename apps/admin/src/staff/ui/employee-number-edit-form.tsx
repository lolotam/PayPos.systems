'use client';
import type { SetEmployeeNumberInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useSetEmployeeNumber } from '../api/use-set-employee-number';
import { displayEmployeeNumber } from '../model/employee-number-display';
import {
  employeeNumberFieldOptions,
  employeeNumberResolver,
} from '../model/employee-number-form-schema';
import { employeeNumberSaveAlert } from '../model/employee-number-save-alert';
import { ModalDialog } from '@/shared/ui/modal-dialog';

type EditFormProps = {
  companyId: string;
  businessId: string;
  userId: string;
  employeeId: string;
  employeeNumber: number | null;
  readOnly: boolean;
  onClose: () => void;
};

export function EmployeeNumberEditForm(props: EditFormProps) {
  const locale = useLocale();
  const save = useSetEmployeeNumber(
    props.companyId,
    props.businessId,
    props.userId,
    props.employeeId,
  );
  const { onClose } = props;
  const form = useForm<SetEmployeeNumberInput>({ resolver: employeeNumberResolver });
  useEffect(() => {
    if (save.isSuccess) onClose();
  }, [onClose, save.isSuccess]);
  const alert = employeeNumberSaveAlert(
    form.formState.errors.employee_number,
    save.isError ? save.error : null,
    t(locale, 'staff.numberInvalid'),
    save.isError ? envelopeMessage(save.error, locale) : '',
  );
  return (
    <ModalDialog
      title={t(locale, 'staff.editNumberTitle')}
      pending={save.isPending}
      onClose={onClose}
      className="max-w-lg"
    >
      <form
        onSubmit={form.handleSubmit((body) => {
          if (!props.readOnly) save.mutate(body.employee_number);
        })}
        className="flex flex-col gap-3"
      >
        <p>
          <span className="sr-only">{t(locale, 'staff.currentNumber')} </span>
          <span dir="ltr">{displayEmployeeNumber(props.employeeNumber)}</span>
        </p>
        <Label htmlFor="employee-number-edit">{t(locale, 'staff.employeeNumber')}</Label>
        <Input
          id="employee-number-edit"
          dir="ltr"
          inputMode="numeric"
          {...form.register('employee_number', employeeNumberFieldOptions)}
          disabled={props.readOnly}
        />
        {alert ? <p role="alert">{alert}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={save.isPending || props.readOnly}>
            {t(locale, 'staff.saveNumber')}
          </Button>
          <Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>
            {t(locale, 'staff.closeNumber')}
          </Button>
        </div>
      </form>
    </ModalDialog>
  );
}
