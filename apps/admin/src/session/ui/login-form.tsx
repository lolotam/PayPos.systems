'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { loginInput, type LoginInput } from '@pospay/contracts';
import type { MessageKey } from '@pospay/i18n';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useForm } from 'react-hook-form';

import { useLocale } from '@/shared/locale/locale-context';

import { TextField } from './text-field';

export function LoginForm({
  pending,
  error,
  onSubmit,
}: {
  pending: boolean;
  error?: MessageKey | undefined;
  onSubmit: (values: LoginInput) => Promise<void>;
}) {
  const locale = useLocale();
  const form = useForm<LoginInput>({
    resolver: zodResolver(loginInput),
    defaultValues: { email: '', password: '' },
  });
  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={form.handleSubmit(onSubmit)}>
      <TextField
        id="email"
        type="email"
        autoComplete="email"
        label={t(locale, 'admin.emailLabel')}
        error={form.formState.errors.email ? 'admin.emailInvalid' : undefined}
        disabled={pending}
        {...form.register('email')}
      />
      <TextField
        id="password"
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
        {t(locale, 'admin.signInSubmit')}
      </Button>
    </form>
  );
}
