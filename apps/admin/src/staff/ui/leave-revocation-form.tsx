'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { revokeLeaveInput, type RevokeLeaveInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import { useForm } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
export function LeaveRevocationForm({
  revision,
  pending,
  onSave,
  onClose,
}: {
  revision: number;
  pending: boolean;
  onSave: (input: RevokeLeaveInput) => void;
  onClose: () => void;
}) {
  const locale = useLocale();
  const form = useForm<RevokeLeaveInput>({
    resolver: zodResolver(revokeLeaveInput),
    defaultValues: { expected_revision: revision, reason: '' },
  });
  return (
    <form onSubmit={form.handleSubmit(onSave)} className="flex flex-col gap-3 text-start">
      <fieldset disabled={pending} className="flex flex-col gap-3">
        <legend>{t(locale, 'leave.revoke')}</legend>
        <Label htmlFor="leave-revocation-reason">{t(locale, 'leave.revocationReason')}</Label>
        <Input id="leave-revocation-reason" maxLength={500} {...form.register('reason')} />
        {form.formState.errors.reason ? (
          <p role="alert">{t(locale, 'errors.LEAVE_REASON_REQUIRED')}</p>
        ) : null}
        <div className="flex gap-2">
          <Button type="submit">{t(locale, 'leave.revoke')}</Button>
          <Button type="button" variant="outline" onClick={onClose}>
            {t(locale, 'leave.close')}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
