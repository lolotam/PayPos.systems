'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { passwordResetRequestForm, type PasswordResetRequestForm } from '@pospay/contracts';
import type { MessageKey } from '@pospay/i18n';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useForm } from 'react-hook-form';

import { useMounted } from '@/shared/browser/use-mounted';
import { useLocale } from '@/shared/locale/locale-context';

import { FormErrorAlert } from './form-error-alert';
import { TextField } from './text-field';

/** الخطوة الأولى: الإيميل بس، والردّ بعده موحّد فمفيش كشف لوجود الحساب. */
export function PasswordResetRequestForm({
  pending,
  error,
  cooldown = 0,
  onSubmit,
  onBack,
}: {
  pending: boolean;
  error?: MessageKey | undefined;
  cooldown?: number | undefined;
  onSubmit: (email: string) => Promise<void>;
  onBack: () => void;
}) {
  const locale = useLocale();
  const mounted = useMounted();
  const waiting = cooldown > 0;
  const form = useForm<PasswordResetRequestForm>({
    resolver: zodResolver(passwordResetRequestForm),
    defaultValues: { email: '' },
  });
  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={form.handleSubmit((values) => onSubmit(values.email.trim().toLowerCase()))}
    >
      <TextField
        id="reset-email"
        type="email"
        autoComplete="email"
        label={t(locale, 'admin.emailLabel')}
        error={form.formState.errors.email ? 'admin.emailInvalid' : undefined}
        disabled={pending}
        {...form.register('email')}
      />
      <FormErrorAlert error={error} />
      <Button type="submit" disabled={pending || waiting || !mounted}>
        {waiting
          ? t(locale, 'passwordReset.resendWait').replace('{seconds}', String(cooldown))
          : t(locale, 'passwordReset.requestSubmit')}
      </Button>
      <Button type="button" variant="link" onClick={onBack} disabled={pending}>
        {t(locale, 'passwordReset.backToSignIn')}
      </Button>
    </form>
  );
}
