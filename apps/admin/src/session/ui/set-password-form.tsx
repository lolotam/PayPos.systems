'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { setPasswordInput, type SetPasswordInput } from '@pospay/contracts';
import type { MessageKey } from '@pospay/i18n';
import { t } from '@pospay/i18n';
import { Button, CircleAlert, EmptyState } from '@pospay/ui';
import { useForm } from 'react-hook-form';

import { useLocale } from '@/shared/locale/locale-context';

import { TextField } from './text-field';

export function SetPasswordForm({
  pending,
  error,
  onSubmit,
}: {
  pending: boolean;
  error?: MessageKey | undefined;
  onSubmit: (newPassword: string) => Promise<void>;
}) {
  const locale = useLocale();
  const form = useForm<SetPasswordInput>({
    resolver: zodResolver(setPasswordInput),
    defaultValues: { password: '', confirm: '' },
  });
  const errors = form.formState.errors;
  const confirmError = errors.confirm
    ? form.getValues('confirm') === ''
      ? 'admin.passwordRequired'
      : 'admin.setPasswordMismatch'
    : undefined;
  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={form.handleSubmit((values) => onSubmit(values.password))}
    >
      <TextField
        id="new-password"
        type="password"
        autoComplete="new-password"
        label={t(locale, 'admin.newPasswordLabel')}
        error={errors.password ? 'admin.setPasswordLength' : undefined}
        disabled={pending}
        {...form.register('password')}
      />
      <TextField
        id="confirm-password"
        type="password"
        autoComplete="new-password"
        label={t(locale, 'admin.confirmPasswordLabel')}
        error={confirmError}
        disabled={pending}
        {...form.register('confirm')}
      />
      {error ? (
        <EmptyState
          role="alert"
          tone="danger"
          icon={<CircleAlert />}
          title={t(locale, error)}
          className="p-4"
        />
      ) : null}
      <Button type="submit" disabled={pending}>
        {t(locale, 'admin.setPasswordSubmit')}
      </Button>
    </form>
  );
}
