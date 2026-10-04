'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { decideLeaveInput, type DecideLeaveInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import { useForm } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
export function LeaveDecisionForm({
  decision,
  revision,
  pending,
  onSave,
  onClose,
}: {
  decision: 'APPROVED' | 'REJECTED';
  revision: number;
  pending: boolean;
  onSave: (input: DecideLeaveInput) => void;
  onClose: () => void;
}) {
  const locale = useLocale();
  const form = useForm<DecideLeaveInput>({
    resolver: zodResolver(decideLeaveInput),
    defaultValues: { decision, expected_revision: revision },
  });
  return (
    <form onSubmit={form.handleSubmit(onSave)} className="flex flex-col gap-3 text-start">
      <fieldset disabled={pending} className="flex flex-col gap-3">
        <legend>{t(locale, decision === 'APPROVED' ? 'leave.approve' : 'leave.reject')}</legend>
        <p>
          {t(
            locale,
            decision === 'APPROVED' ? 'leave.optionalApprovalReason' : 'leave.requiredReason',
          )}
        </p>
        <Label htmlFor="leave-decision-reason">{t(locale, 'leave.reason')}</Label>
        <Input
          id="leave-decision-reason"
          maxLength={500}
          {...form.register('reason', {
            setValueAs: (value: string) =>
              decision === 'APPROVED' && !value.trim() ? undefined : value,
          })}
        />
        {form.formState.errors.reason ? (
          <p role="alert">{t(locale, 'errors.LEAVE_REASON_REQUIRED')}</p>
        ) : null}
        <div className="flex gap-2">
          <Button type="submit">
            {t(locale, decision === 'APPROVED' ? 'leave.approve' : 'leave.reject')}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            {t(locale, 'leave.close')}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
