'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { confirmPasswordInput, type ConfirmPasswordInput } from '@pospay/contracts';
import type { MessageKey } from '@pospay/i18n';
import { t } from '@pospay/i18n';
import { Button, EmptyState, CircleAlert } from '@pospay/ui';
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
        <EmptyState
          role="alert"
          tone="danger"
          icon={<CircleAlert />}
          title={t(locale, error)}
          className="p-4"
        />
      ) : null}
      <Button type="submit" disabled={pending}>
        {t(locale, 'admin.enrolContinue')}
      </Button>
    </form>
  );
}
