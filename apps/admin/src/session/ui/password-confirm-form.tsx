'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { confirmPasswordInput, type ConfirmPasswordInput } from '@pospay/contracts';
import type { MessageKey } from '@pospay/i18n';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useForm } from 'react-hook-form';

import { useLocale } from '@/shared/locale/locale-context';

import { TextField } from './text-field';

export function PasswordConfirmForm({
  pending,
  error,
  onSubmit,
}: {
  pending: boolean;
  error?: MessageKey | undefined;
  onSubmit: (values: ConfirmPasswordInput) => Promise<void>;
}) {
  const locale = useLocale();
  const form = useForm<ConfirmPasswordInput>({
    resolver: zodResolver(confirmPasswordInput),
    defaultValues: { password: '' },
  });
  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={form.handleSubmit(onSubmit)}>
      <TextField
        id="enrol-password"
        type="password"
        autoComplete="current-password"
        label={t(locale, 'admin.passwordLabel')}
        error={form.formState.errors.password ? 'admin.passwordRequired' : undefined}
        disabled={pending}
        {...form.register('password')}
      />
      {error ? (
        <p role="alert" className="text-start text-sm text-destructive">
          {t(locale, error)}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {t(locale, 'admin.enrolContinue')}
      </Button>
    </form>
  );
}
