import { zodResolver } from '@hookform/resolvers/zod';
import { registerDeviceInput, type RegisterDeviceInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { useLocale } from '@/shared/locale/locale-context';

import { TextField } from './text-field';

export function PairingForm({
  onSubmit,
}: {
  onSubmit: (values: RegisterDeviceInput) => Promise<string | null>;
}) {
  const locale = useLocale();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<RegisterDeviceInput>({
    resolver: zodResolver(registerDeviceInput),
    defaultValues: { pairing_code: '', label: '' },
  });
  const submit = async (values: RegisterDeviceInput): Promise<void> => {
    setPending(true);
    setError(null);
    const message = await onSubmit(values);
    if (message === null) return;
    setError(message);
    setPending(false);
  };
  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={form.handleSubmit(submit)}>
      <TextField
        id="pairing-code"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        className="uppercase"
        label={t(locale, 'pos.pairingCodeLabel')}
        error={form.formState.errors.pairing_code ? 'pos.pairingCodeInvalid' : undefined}
        disabled={pending}
        {...form.register('pairing_code')}
      />
      <TextField
        id="device-label"
        autoComplete="off"
        label={t(locale, 'pos.deviceLabel')}
        error={form.formState.errors.label ? 'pos.labelInvalid' : undefined}
        disabled={pending}
        {...form.register('label')}
      />
      {error ? (
        <p role="alert" className="text-start text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {t(locale, pending ? 'pos.loading' : 'pos.pairSubmit')}
      </Button>
    </form>
  );
}
