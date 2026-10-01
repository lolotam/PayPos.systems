'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { totpCodeInput, type TotpCodeInput } from '@pospay/contracts';
import type { MessageKey } from '@pospay/i18n';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useForm } from 'react-hook-form';

import { useLocale } from '@/shared/locale/locale-context';

import { TextField } from './text-field';

export function TotpForm({
  pending,
  error,
  onSubmit,
}: {
  pending: boolean;
  error?: MessageKey | undefined;
  onSubmit: (values: TotpCodeInput) => Promise<void>;
}) {
  const locale = useLocale();
  const form = useForm<TotpCodeInput>({
    resolver: zodResolver(totpCodeInput),
    defaultValues: { code: '' },
  });
  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={form.handleSubmit(onSubmit)}>
      <TextField
        id="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        label={t(locale, 'admin.codeLabel')}
        error={form.formState.errors.code ? 'admin.codeInvalid' : undefined}
        disabled={pending}
        {...form.register('code')}
      />
      {error ? (
        <p role="alert" className="text-start text-sm text-destructive">
          {t(locale, error)}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {t(locale, 'admin.verifySubmit')}
      </Button>
    </form>
  );
}
