'use client';
import { revokePermissionOverrideInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import { useState, type FormEvent } from 'react';
import { useLocale } from '@/shared/locale/locale-context';

export function PermissionRevokeForm({
  overrideId,
  disabled,
  onRevoke,
}: {
  overrideId: string;
  disabled: boolean;
  onRevoke: (overrideId: string, reason: string) => void;
}) {
  const locale = useLocale();
  const [reason, setReason] = useState('');
  const [invalid, setInvalid] = useState(false);
  function submit(event: FormEvent) {
    event.preventDefault();
    const result = revokePermissionOverrideInput.safeParse({ reason });
    setInvalid(!result.success);
    if (result.success) onRevoke(overrideId, result.data.reason);
  }
  return (
    <form onSubmit={submit} className="mt-3 flex flex-col gap-2 text-start">
      <Label htmlFor={`revoke-${overrideId}`}>{t(locale, 'permissions.reason')}</Label>
      <Input
        id={`revoke-${overrideId}`}
        value={reason}
        maxLength={500}
        disabled={disabled}
        onChange={(event) => setReason(event.target.value)}
      />
      <Button type="submit" variant="destructive" className="self-start" disabled={disabled}>
        {t(locale, 'permissions.revoke')}
      </Button>
      {invalid ? <p role="alert">{t(locale, 'permissions.invalid')}</p> : null}
    </form>
  );
}
