'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { unbindPasskeyInput, type UnbindPasskeyInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import { useForm } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
export function UnbindPasskeyForm({
  bindingId,
  revision,
  pending,
  onSave,
}: {
  bindingId: string;
  revision: number;
  pending: boolean;
  onSave: (input: UnbindPasskeyInput) => void;
}) {
  const locale = useLocale();
  const form = useForm<UnbindPasskeyInput>({
    resolver: zodResolver(unbindPasskeyInput),
    defaultValues: { binding_id: bindingId, revision, reason: '' },
  });
  return (
    <form onSubmit={form.handleSubmit(onSave)} className="flex flex-col gap-3 text-start">
      <p>{t(locale, 'passkeyAdmin.warning')}</p>
      <p>{t(locale, 'phoneLock.release')}</p>
      <fieldset disabled={pending} className="flex flex-col gap-3">
        <Label htmlFor="passkey-unbind-reason">{t(locale, 'passkeyAdmin.reason')}</Label>
        <Input id="passkey-unbind-reason" maxLength={500} {...form.register('reason')} />
        <Button type="submit" variant="destructive">
          {t(locale, 'passkeyAdmin.unbind')}
        </Button>
      </fieldset>
      {form.formState.errors.reason ? (
        <p role="alert">{t(locale, 'passkeyAdmin.invalid')}</p>
      ) : null}
    </form>
  );
}
