'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { passwordResetVerifyForm, type PasswordResetVerifyForm } from '@pospay/contracts';
import type { MessageKey } from '@pospay/i18n';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useForm } from 'react-hook-form';

import { useMounted } from '@/shared/browser/use-mounted';
import { useLocale } from '@/shared/locale/locale-context';

import { FormErrorAlert } from './form-error-alert';
import { NewPasswordFields } from './new-password-fields';
import { PasswordResetResendButton } from './password-reset-resend-button';
import { TextField } from './text-field';

/** الخطوة التانية: الكود المكوّن من ٦ أرقام وكلمة المرور الجديدة وتأكيدها، وإعادة الإرسال بعد العدّاد. */
export function PasswordResetVerifyForm({
  pending,
  error,
  cooldown,
  onSubmit,
  onResend,
  onBack,
}: {
  pending: boolean;
  error?: MessageKey | undefined;
  cooldown: number;
  onSubmit: (code: string, newPassword: string) => Promise<void>;
  onResend: () => Promise<void>;
  onBack: () => void;
}) {
  const locale = useLocale();
  const mounted = useMounted();
  const form = useForm<PasswordResetVerifyForm>({
    resolver: zodResolver(passwordResetVerifyForm),
    defaultValues: { code: '', password: '', confirm: '' },
  });
  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={form.handleSubmit((values) => onSubmit(values.code, values.password))}
    >
      <TextField
        id="reset-code"
        dir="ltr"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        label={t(locale, 'passwordReset.codeLabel')}
        error={form.formState.errors.code ? 'passwordReset.codeInvalid' : undefined}
        disabled={pending}
        {...form.register('code')}
      />
      <NewPasswordFields form={form} pending={pending} />
      <FormErrorAlert error={error} />
      <Button type="submit" disabled={pending || !mounted}>
        {t(locale, 'passwordReset.resetSubmit')}
      </Button>
      <PasswordResetResendButton disabled={pending} cooldown={cooldown} onResend={onResend} />
      <Button type="button" variant="link" onClick={onBack} disabled={pending}>
        {t(locale, 'passwordReset.backToSignIn')}
      </Button>
    </form>
  );
}
