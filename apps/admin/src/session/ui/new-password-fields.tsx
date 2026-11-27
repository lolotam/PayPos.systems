'use client';

import type { PasswordResetVerifyForm } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import type { UseFormReturn } from 'react-hook-form';

import { useLocale } from '@/shared/locale/locale-context';

import { TextField } from './text-field';

/** حقلا كلمة المرور الجديدة وتأكيدها مع رسالة عدم التطابق جنب حقل التأكيد. */
export function NewPasswordFields({
  form,
  pending,
}: {
  form: UseFormReturn<PasswordResetVerifyForm>;
  pending: boolean;
}) {
  const locale = useLocale();
  const confirmError = form.formState.errors.confirm
    ? form.getValues('confirm') === ''
      ? 'admin.passwordRequired'
      : 'admin.setPasswordMismatch'
    : undefined;
  return (
    <>
      <TextField
        id="reset-new-password"
        type="password"
        autoComplete="new-password"
        label={t(locale, 'admin.newPasswordLabel')}
        error={form.formState.errors.password ? 'admin.setPasswordLength' : undefined}
        disabled={pending}
        {...form.register('password')}
      />
      <TextField
        id="reset-confirm-password"
        type="password"
        autoComplete="new-password"
        label={t(locale, 'admin.confirmPasswordLabel')}
        error={confirmError}
        disabled={pending}
        {...form.register('confirm')}
      />
    </>
  );
}
