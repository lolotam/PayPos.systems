'use client';
import type { ChangeEmployeeStaffPhoneInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { ModalDialog } from '@/shared/ui/modal-dialog';
import { useChangeEmployeeStaffPhone } from '../api/use-change-employee-staff-phone';
import { changePhoneDefaults, changePhoneResolver } from '../model/staff-access-form-schema';

type PhoneFormProps = {
  companyId: string;
  businessId: string;
  employeeId: string;
  onClose: () => void;
};

/** حقول التغيير: الهاتف الجديد (تعديله بيمسح التأكيد) والتأكيد والرقم السري المؤقت الجديد. */
function PhoneChangeFields({ form }: { form: UseFormReturn<ChangeEmployeeStaffPhoneInput> }) {
  const locale = useLocale();
  const confirmed = form.watch('phone_confirmed');
  return (
    <>
      <Label htmlFor="staff-access-change-phone">{t(locale, 'staff.changePhoneLabel')}</Label>
      <Input
        id="staff-access-change-phone"
        dir="ltr"
        inputMode="tel"
        {...form.register('phone', {
          // تغيير الرقم بيمسح التأكيد: التعلم على رقم ما اتأكدش عليه بعد ما يتغير.
          onChange: () =>
            form.setValue('phone_confirmed', false as true, { shouldValidate: true }),
        })}
      />
      {form.formState.errors.phone ? <p role="alert">{t(locale, 'staff.phoneInvalid')}</p> : null}
      <label className="flex items-center gap-2">
        <input type="checkbox" {...form.register('phone_confirmed')} />
        <span>{t(locale, 'staff.phoneConfirmed')}</span>
      </label>
      {confirmed !== true ? <p role="alert">{t(locale, 'staff.confirmationRequired')}</p> : null}
      <Label htmlFor="staff-access-change-pin">{t(locale, 'staff.changePhonePinLabel')}</Label>
      <Input
        id="staff-access-change-pin"
        dir="ltr"
        inputMode="numeric"
        maxLength={4}
        {...form.register('pin')}
      />
      {form.formState.errors.pin ? <p role="alert">{t(locale, 'staff.pinInvalid')}</p> : null}
    </>
  );
}

/** نموذج تغيير الهاتف: نداء مباشر من غير كاش، والرد الملتزم هو الحالة اللي بتظهر بعد الإغلاق. */
export function EmployeeAccessPhoneForm(props: PhoneFormProps) {
  const locale = useLocale();
  const save = useChangeEmployeeStaffPhone(props.companyId, props.businessId, props.employeeId);
  const { onClose } = props;
  const form = useForm<ChangeEmployeeStaffPhoneInput>({
    resolver: changePhoneResolver,
    defaultValues: changePhoneDefaults,
  });
  return (
    <ModalDialog
      title={t(locale, 'staff.changePhoneTitle')}
      pending={save.isPending}
      onClose={onClose}
      className="max-w-lg"
    >
      <form onSubmit={form.handleSubmit((body) => save.mutate(body))} className="flex flex-col gap-3">
        <PhoneChangeFields form={form} />
        {save.isError ? <p role="alert">{envelopeMessage(save.error, locale)}</p> : null}
        {save.isSuccess ? <p>{t(locale, 'staff.phoneChangedMessage')}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={save.isPending}>
            {t(locale, 'staff.changePhoneButton')}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            {t(locale, 'staff.closeDialog')}
          </Button>
        </div>
      </form>
    </ModalDialog>
  );
}
