import { zodResolver } from '@hookform/resolvers/zod';
import { registerDeviceInput, type RegisterDeviceInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, EmptyState, CircleAlert } from '@pospay/ui';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { useLocale } from '@/shared/locale/locale-context';

import { TextField } from './text-field';

export function PairingForm({
  onSubmit,
  locked = false,
}: {
  onSubmit: (values: RegisterDeviceInput) => Promise<string | null>;
  locked?: boolean;
}) {
  const locale = useLocale();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // أثناء الرجوع لاختيار نوع الجهاز، اقتران جديد هيحفظ حالة خطوة الرجوع مش قادرة تلغيها.
  const disabled = pending || locked;
  const form = useForm<RegisterDeviceInput>({
    resolver: zodResolver(registerDeviceInput),
    defaultValues: { pairing_code: '', label: '' },
  });
  const submit = async (values: RegisterDeviceInput): Promise<void> => {
    if (locked) return;
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
        disabled={disabled}
        {...form.register('pairing_code')}
      />
      <TextField
        id="device-label"
        autoComplete="off"
        label={t(locale, 'pos.deviceLabel')}
        error={form.formState.errors.label ? 'pos.labelInvalid' : undefined}
        disabled={disabled}
        {...form.register('label')}
      />
      {error ? (
        <EmptyState
          role="alert"
          tone="danger"
          icon={<CircleAlert />}
          title={error}
          className="p-4"
        />
      ) : null}
      <Button size="touch" type="submit" disabled={disabled}>
        {t(locale, pending ? 'pos.loading' : 'pos.pairSubmit')}
      </Button>
    </form>
  );
}
