'use client';
import type { GrantStaffAccessInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Input, Label } from '@pospay/ui';
import type { UseFormReturn } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import {
  EmployeeRecoveryEmailField,
  newRecoveryEmailOptions,
} from './employee-recovery-email-field';

/** حقول نموذج المنح: الهاتف والتأكيد والدور والرقم السري — نفس عقد السيرفر بالحرف. */
export function EmployeeAccessFields({ form }: { form: UseFormReturn<GrantStaffAccessInput> }) {
  const locale = useLocale();
  const confirmed = form.watch('phone_confirmed');
  return (
    <>
      <Label htmlFor="staff-access-phone">{t(locale, 'staff.phoneLabel')}</Label>
      <Input
        id="staff-access-phone"
        dir="ltr"
        inputMode="tel"
        {...form.register('phone', {
          // تغيير الرقم بيمسح التأكيد: التعلم على رقم ما اتأكدش عليه بعد ما يتغير.
          onChange: () => form.setValue('phone_confirmed', false as true, { shouldValidate: true }),
        })}
      />
      {form.formState.errors.phone ? <p role="alert">{t(locale, 'staff.phoneInvalid')}</p> : null}
      <label className="flex items-center gap-2">
        <input type="checkbox" {...form.register('phone_confirmed')} />
        <span>{t(locale, 'staff.phoneConfirmed')}</span>
      </label>
      {confirmed !== true ? <p role="alert">{t(locale, 'staff.confirmationRequired')}</p> : null}
      <Label htmlFor="staff-access-role">{t(locale, 'staff.accessRole')}</Label>
      <select id="staff-access-role" {...form.register('role')}>
        <option value="staff">{t(locale, 'staff.roleStaff')}</option>
        <option value="reception">{t(locale, 'staff.roleReception')}</option>
      </select>
      <Label htmlFor="staff-access-pin">{t(locale, 'staff.pinLabel')}</Label>
      <Input
        id="staff-access-pin"
        dir="ltr"
        inputMode="numeric"
        maxLength={4}
        {...form.register('pin')}
      />
      {form.formState.errors.pin ? <p role="alert">{t(locale, 'staff.pinInvalid')}</p> : null}
      <EmployeeRecoveryEmailField
        field={form.register('recovery_email', newRecoveryEmailOptions)}
        invalid={form.formState.errors.recovery_email !== undefined}
      />
    </>
  );
}
