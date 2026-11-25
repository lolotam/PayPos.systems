'use client';
import type { ResetEmployeeStaffPinInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import { useForm } from 'react-hook-form';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { ModalDialog } from '@/shared/ui/modal-dialog';
import { useResetEmployeeStaffPin } from '../api/use-reset-employee-staff-pin';
import {
  resetStaffPinDefaults,
  resetStaffPinResolver,
} from '../model/staff-access-form-schema';

type PinResetFormProps = {
  companyId: string;
  businessId: string;
  employeeId: string;
  onClose: () => void;
};

/** نموذج إعادة ضبط الرقم السري: رقم سري جديد بس، والطلب نداء مباشر من غير كاش. */
export function EmployeeAccessPinResetForm(props: PinResetFormProps) {
  const locale = useLocale();
  const save = useResetEmployeeStaffPin(props.companyId, props.businessId, props.employeeId);
  const { onClose } = props;
  const form = useForm<ResetEmployeeStaffPinInput>({
    resolver: resetStaffPinResolver,
    defaultValues: resetStaffPinDefaults,
  });
  return (
    <ModalDialog
      title={t(locale, 'staff.resetPinTitle')}
      pending={save.isPending}
      onClose={onClose}
      className="max-w-lg"
    >
      <form onSubmit={form.handleSubmit((body) => save.mutate(body))} className="flex flex-col gap-3">
        <Label htmlFor="staff-access-reset-pin">{t(locale, 'staff.resetPinLabel')}</Label>
        <Input
          id="staff-access-reset-pin"
          dir="ltr"
          inputMode="numeric"
          maxLength={4}
          {...form.register('pin')}
        />
        {form.formState.errors.pin ? <p role="alert">{t(locale, 'staff.pinInvalid')}</p> : null}
        {save.isError ? <p role="alert">{envelopeMessage(save.error, locale)}</p> : null}
        {save.isSuccess ? <p>{t(locale, 'staff.pinResetMessage')}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={save.isPending}>
            {t(locale, 'staff.resetPinButton')}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            {t(locale, 'staff.closeDialog')}
          </Button>
        </div>
      </form>
    </ModalDialog>
  );
}
