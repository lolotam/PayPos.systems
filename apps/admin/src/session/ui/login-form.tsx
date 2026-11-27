'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { loginInput, type LoginInput } from '@pospay/contracts';
import type { MessageKey } from '@pospay/i18n';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useForm } from 'react-hook-form';

import { useMounted } from '@/shared/browser/use-mounted';
import { useLocale } from '@/shared/locale/locale-context';

import { FormErrorAlert } from './form-error-alert';
import { TextField } from './text-field';

export function LoginForm({
  pending,
  error,
  onSubmit,
  onForgotPassword,
}: {
  pending: boolean;
  error?: MessageKey | undefined;
  onSubmit: (values: LoginInput) => Promise<void>;
  /** يفتح مسار استرجاع كلمة المرور؛ من غيره الرابط مش بيظهر. */
  onForgotPassword?: (() => void) | undefined;
}) {
  const locale = useLocale();
  const mounted = useMounted();
  const form = useForm<LoginInput>({
    resolver: zodResolver(loginInput),
    defaultValues: { email: '', password: '' },
  });
  return (
    <form
      method="post"
      className="flex flex-col gap-4"
      noValidate
      onSubmit={form.handleSubmit(onSubmit)}
    >
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
      <FormErrorAlert error={error} />
      <Button type="submit" disabled={pending || !mounted}>
        {t(locale, 'admin.signInSubmit')}
      </Button>
      {onForgotPassword ? (
        <Button type="button" variant="link" onClick={onForgotPassword} disabled={pending}>
          {t(locale, 'passwordReset.link')}
        </Button>
      ) : null}
    </form>
  );
}
